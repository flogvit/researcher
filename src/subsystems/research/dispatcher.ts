import type { SubsystemContext } from '../../core/subsystem';
import type { ModuleConfig } from '../../core/module-config';
import { getDb } from '../../db/connection';
import { agentTasks, findings, researchLog, projects, documents, embeddings } from '../../db/schema';
import { eq, desc, sql, asc, and } from 'drizzle-orm';
import { LLM, RateLimitError, createLLM } from '../../llm/llm';
import { Logger } from '../../core/logger';
import { loadPrompt, loadModuleConfig } from '../../core/prompt-loader';
import { claimNextTask } from '../../core/task-queue';
import { escapeLike } from '../../core/like-escape';
import { Triage } from './triage';
import { Reviewer } from './reviewer';
import { Reflector } from './reflector';
import { TaskGenerator } from './task-generator';
import { Supervisor } from './supervisor';
import { PromptAgent } from './agents/prompt-agent';
import type { BaseAgent } from './agents/base-agent';
import { resolve } from 'node:path';
import { searchSimilar } from '../../llm/embeddings';

export class ResearchDispatcher {
  private running = false;
  private tasksSinceReflection = 0;
  private lastSupervisorTime = 0;
  private lastGenerateTime = 0;
  private agents: Map<string, BaseAgent> = new Map();
  private log = new Logger('research');
  private projectDir: string;
  private moduleConfig: ModuleConfig | null = null;

  constructor() {
    this.projectDir = process.cwd();
  }

  private llmFor(agentName: string, ctx: SubsystemContext): LLM {
    return createLLM(agentName, ctx.config.llm, ctx.config.agents);
  }

  private async getModuleConfig(): Promise<ModuleConfig> {
    if (!this.moduleConfig) {
      this.moduleConfig = await loadModuleConfig(this.projectDir, 'research');
    }
    return this.moduleConfig;
  }

  private isStepEnabled(config: ModuleConfig, stepName: string): boolean {
    const step = config.steps.find(s => s.name === stepName);
    return step?.enabled !== false;
  }

  async start(ctx: SubsystemContext): Promise<void> {
    this.running = true;
    const config = await this.getModuleConfig();
    this.log.info('Research dispatcher started');

    while (this.running) {
      try {
        await this.tick(ctx, config);
      } catch (e) {
        if (e instanceof RateLimitError) {
          this.log.warn(`Rate limited. Waiting ${Math.ceil(e.waitMs / 60000)} min...`);
          const cap = config.rateLimitRecoveryCap ?? 60000;
          await Bun.sleep(Math.min(e.waitMs, cap));
        } else {
          this.log.error(`Tick error: ${e instanceof Error ? e.message : e}`);
        }
      }
      await Bun.sleep(config.tickInterval ?? 2000);
    }

    this.log.info('Research dispatcher stopped');
  }

  async runOnce(ctx: SubsystemContext): Promise<void> {
    this.log.info('Running research (one pass)');
    const config = await this.getModuleConfig();

    // Process all pending tasks
    let processed = true;
    while (processed) {
      processed = await this.processOneTask(ctx, config);
    }

    // Check project phases
    await this.checkProjects(ctx);

    // Reflect if needed
    if (this.tasksSinceReflection > 0 && this.isStepEnabled(config, 'reflect')) {
      await this.runReflection(ctx);
    }

    this.log.info('Research pass complete');
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  private async tick(ctx: SubsystemContext, config: ModuleConfig): Promise<void> {
    if (LLM.isCurrentlyRateLimited()) return;

    const now = Date.now();

    // Try to process a task
    const didWork = await this.processOneTask(ctx, config);

    if (!didWork) {
      // No tasks — maybe reflect
      const reflectStep = config.steps.find(s => s.name === 'reflect');
      const reflectEvery = reflectStep?.every ?? ctx.config.research?.reflectEvery ?? 3;
      if (this.isStepEnabled(config, 'reflect') && this.tasksSinceReflection >= reflectEvery) {
        await this.runReflection(ctx);
        return;
      }

      // Or generate work
      if (this.isStepEnabled(config, 'generate-work')) {
        await this.runGenerateWork(ctx);
      }
    }

    // Check project phases
    await this.checkProjects(ctx);

    // Supervisor
    const supervisorStep = config.steps.find(s => s.name === 'supervisor');
    const supervisorInterval = (supervisorStep?.every ?? 300) * 1000;
    if (this.isStepEnabled(config, 'supervisor') && now - this.lastSupervisorTime > supervisorInterval) {
      this.lastSupervisorTime = now;
      await this.runSupervisor(ctx);
    }
  }

  private async processOneTask(ctx: SubsystemContext, config: ModuleConfig): Promise<boolean> {
    const db = getDb();

    // Atomically claim oldest pending non-admin task. Admin tasks live in the
    // same agent_tasks table but use the 'admin:*' agent_type prefix; the
    // research dispatcher must skip them so the web admin processor can
    // handle them (issue #51).
    const task = await claimNextTask('research');
    if (!task) return false;

    const taskDescription = (task.payload as Record<string, unknown>)?.description
      ?? (task.payload as Record<string, unknown>)?.task ?? 'unknown task';

    // Triage (skip for split children)
    const isSplitChild = (task.payload as Record<string, unknown>)?.fromSplit === true;
    if (!isSplitChild && this.isStepEnabled(config, 'triage')) {
      try {
        const triage = new Triage(this.llmFor('triage', ctx), this.projectDir);
        const triageResult = await triage.evaluate(task.agentType, String(taskDescription));

        if (triageResult.verdict === 'split' && triageResult.subtasks?.length) {
          for (const sub of triageResult.subtasks) {
            await db.insert(agentTasks).values({
              agentType: sub.agentType,
              status: 'pending',
              priority: sub.priority,
              payload: { description: sub.description, fromSplit: true },
            });
          }
          await db.update(agentTasks)
            .set({ status: 'completed', result: { triaged: 'split' }, completedAt: new Date() })
            .where(eq(agentTasks.id, task.id));
          await db.insert(researchLog).values({
            eventType: 'task_split',
            agentType: task.agentType,
            details: { taskId: task.id, description: taskDescription, subtasks: triageResult.subtasks.length },
          });
          return true;
        }

        if (triageResult.verdict === 'skip') {
          await db.update(agentTasks)
            .set({ status: 'completed', result: { triaged: 'skipped' }, completedAt: new Date() })
            .where(eq(agentTasks.id, task.id));
          return true;
        }
      } catch {
        // Triage failed, proceed with original task
      }
    }

    // Execute
    if (this.isStepEnabled(config, 'execute')) {
      try {
        const agent = this.getAgent(task.agentType, this.llmFor('researcher', ctx));
        const result = await agent.execute(task.payload as Record<string, unknown>);

        // Review
        let reviewQuality = 'unreviewed';
        if (this.isStepEnabled(config, 'review')) {
          try {
            const reviewer = new Reviewer(this.llmFor('reviewer', ctx), this.projectDir);
            const review = await reviewer.review(String(taskDescription), result);
            reviewQuality = review.quality;
            if (!review.approved) {
              result.evidenceStrength = 'speculation';
            }
          } catch {
            // Review failed, keep original strength
          }
        }

        // Save finding
        await db.insert(findings).values({
          agentType: task.agentType,
          taskId: task.id,
          finding: result.finding,
          evidenceStrength: result.evidenceStrength,
          reasoning: result.reasoning,
          sources: result.sources,
          metadata: { ...result.metadata ?? {}, reviewQuality },
        });

        // Mark task completed
        await db.update(agentTasks)
          .set({ status: 'completed', result, completedAt: new Date() })
          .where(eq(agentTasks.id, task.id));

        await db.insert(researchLog).values({
          eventType: 'task_completed',
          agentType: task.agentType,
          details: {
            taskId: task.id,
            description: taskDescription,
            finding: result.finding,
            evidenceStrength: result.evidenceStrength,
            reviewQuality,
          },
        });

        this.tasksSinceReflection++;
        this.log.info(`Task ${task.id} completed (${task.agentType}): ${result.evidenceStrength}`);
        return true;
      } catch (error) {
        if (error instanceof RateLimitError) {
          // Rate-limit is transient — reset the task so it gets retried after
          // the provider recovers. Without this the task is stuck in_progress
          // forever (#23). recoverStaleTasks at startup is the safety net,
          // but recovering inline is cheaper than waiting for a restart.
          await db.update(agentTasks)
            .set({ status: 'pending', startedAt: null })
            .where(eq(agentTasks.id, task.id));
          this.log.warn(`Task ${task.id} reset to pending due to rate-limit`);
          throw error;
        }

        const message = error instanceof Error ? error.message : String(error);
        await db.update(agentTasks)
          .set({ status: 'failed', error: message, completedAt: new Date() })
          .where(eq(agentTasks.id, task.id));
        await db.insert(researchLog).values({
          eventType: 'task_failed',
          agentType: task.agentType,
          details: { taskId: task.id, description: taskDescription, error: message },
        });
        this.log.error(`Task ${task.id} failed: ${message}`);
        return true;
      }
    }

    return false;
  }

  private async runReflection(ctx: SubsystemContext): Promise<void> {
    const db = getDb();
    const llm = this.llmFor('reflector', ctx);
    const agentTypes = ctx.config.research?.agentTypes ?? [];
    const strategyPath = resolve(this.projectDir, ctx.config.research?.strategyFile ?? 'research/strategy.md');

    this.tasksSinceReflection = 0;

    const config = await this.getModuleConfig();
    const reflectStep = config.steps.find(s => s.name === 'reflect');
    const maxTasks = reflectStep?.maxTasks ?? 3;

    const reflector = new Reflector(llm, strategyPath, this.projectDir);
    const recentFindings = await db.select().from(findings).orderBy(desc(findings.createdAt)).limit(10);

    const reflection = await reflector.reflect(
      recentFindings.map(f => ({ agentType: f.agentType, result: f.finding })),
      agentTypes,
    );

    for (const next of reflection.nextTasks.slice(0, maxTasks)) {
      await db.insert(agentTasks).values({
        agentType: next.agentType,
        status: 'pending',
        priority: next.priority,
        payload: { description: next.description },
      });
    }

    await db.insert(researchLog).values({
      eventType: 'reflection',
      agentType: 'dispatcher',
      details: { learnings: reflection.learnings, newTasks: reflection.nextTasks.length },
    });

    this.log.info(`Reflection: ${reflection.learnings.length} learnings, ${reflection.nextTasks.length} new tasks`);
  }

  private async runGenerateWork(ctx: SubsystemContext): Promise<void> {
    const db = getDb();
    const now = Date.now();
    const config = await this.getModuleConfig();
    const cooldown = config.generateWorkCooldown ?? 300_000;

    if (now - this.lastGenerateTime < cooldown) return;
    this.lastGenerateTime = now;

    const llm = this.llmFor('task-generator', ctx);
    const agentTypes = ctx.config.research?.agentTypes ?? [];
    const strategyPath = resolve(this.projectDir, ctx.config.research?.strategyFile ?? 'research/strategy.md');

    const recentFindings = await db
      .select({ finding: findings.finding })
      .from(findings)
      .orderBy(desc(findings.createdAt))
      .limit(10);

    const generator = new TaskGenerator(llm, strategyPath, this.projectDir);
    const result = await generator.generate(
      recentFindings.map(f => f.finding),
      null,
      agentTypes,
    );

    const maxTasks = config.maxTasksPerCycle ?? 5;
    for (const task of result.tasks.slice(0, maxTasks)) {
      await db.insert(agentTasks).values({
        agentType: task.agentType,
        status: 'pending',
        priority: task.priority,
        payload: { description: task.description },
      });
    }

    await db.insert(researchLog).values({
      eventType: 'generate_work',
      agentType: 'dispatcher',
      details: { reasoning: result.reasoning, tasksGenerated: result.tasks.length },
    });

    this.log.info(`Generated ${result.tasks.length} new tasks`);
  }

  private async runSupervisor(ctx: SubsystemContext): Promise<void> {
    const llm = this.llmFor('supervisor', ctx);
    const supervisor = new Supervisor(llm, this.projectDir);
    await supervisor.check();
  }

  private async checkProjects(ctx: SubsystemContext): Promise<void> {
    if (LLM.isCurrentlyRateLimited()) return;

    const db = getDb();

    // Single GROUP BY query instead of N+1 COUNTs per tick. Each tick is
    // every 2s and active-project count grows linearly; #43.
    const activeProjects = await db
      .select()
      .from(projects)
      .where(eq(projects.status, 'active'));
    if (activeProjects.length === 0) return;

    const activeIds = activeProjects.map(p => p.id);
    const counts = await db.execute<{ project_id: number; n: number }>(sql`
      SELECT project_id, COUNT(*)::int AS n
      FROM agent_tasks
      WHERE project_id = ANY(${activeIds})
        AND status IN ('pending','in_progress')
      GROUP BY project_id
    `);
    const countRows = (counts as unknown as { rows?: Array<{ project_id: number; n: number }> }).rows
      ?? (Array.isArray(counts) ? (counts as Array<{ project_id: number; n: number }>) : []);
    const taskCountByProject = new Map(countRows.map(r => [r.project_id, r.n]));

    for (const project of activeProjects) {
      if ((taskCountByProject.get(project.id) ?? 0) > 0) continue;

      try {
        await this.runProjectPhase(project, ctx);
      } catch (e) {
        if (e instanceof RateLimitError) throw e;
        this.log.error(`Project "${project.title}" phase error: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  private async runProjectPhase(
    project: typeof projects.$inferSelect,
    ctx: SubsystemContext,
  ): Promise<void> {
    this.log.info(`Project "${project.title}" — phase: ${project.phase}`);

    switch (project.phase) {
      case 'literature_search':
        await this.projectLiteratureSearch(project, ctx);
        break;
      case 'literature_review':
        await this.projectLiteratureReview(project, ctx);
        break;
      case 'identify_gaps':
        await this.projectIdentifyGaps(project, ctx);
        break;
      case 'research':
        await this.projectResearch(project, ctx);
        break;
      case 'paper':
        await this.projectWritePaper(project, ctx);
        break;
    }
  }

  private async projectLiteratureSearch(
    project: typeof projects.$inferSelect,
    ctx: SubsystemContext,
  ): Promise<void> {
    this.log.info(`Project "${project.title}": searching for existing research...`);
    const db = getDb();

    // Semantic search using embeddings
    const config = await this.getModuleConfig();
    const semanticLimit = config.semanticSearchLimit ?? 20;
    const keywordLimit = config.keywordSearchLimit ?? 20;
    let semanticResults: Array<{ sourceId: number | null }> = [];
    try {
      semanticResults = await searchSimilar(project.title, semanticLimit);
    } catch (e) {
      this.log.warn(`Semantic search failed: ${e instanceof Error ? e.message : e}`);
    }

    // Keyword search on documents. One query OR'd across all keyword patterns
    // backed by trigram GIN indexes on title+content (#38). Previously this
    // was N separate full-table scans. LIKE metacharacters in the keywords
    // are escaped so a project title with '%' or '_' doesn't match the whole
    // table (#28).
    const keywords = project.title.split(/\s+/).filter(w => w.length > 3);
    const keywordPatterns = keywords.map(k => `%${escapeLike(k)}%`);

    let keywordDocs: Array<{ id: number }> = [];
    if (keywordPatterns.length > 0) {
      keywordDocs = await db
        .select({ id: documents.id })
        .from(documents)
        .where(sql`${documents.title} ILIKE ANY(${keywordPatterns}) OR ${documents.content} ILIKE ANY(${keywordPatterns})`)
        .limit(keywordLimit * keywords.length);
    }

    // Combine unique document IDs
    const docIds = new Set<number>();
    for (const r of semanticResults) {
      if (r.sourceId != null) docIds.add(r.sourceId);
    }
    for (const d of keywordDocs) {
      docIds.add(d.id);
    }

    const materialsCount = docIds.size;

    // Log and advance phase
    await db.insert(researchLog).values({
      eventType: 'project_phase_complete',
      agentType: 'dispatcher',
      details: {
        projectId: project.id,
        title: project.title,
        phase: 'literature_search',
        materialsFound: materialsCount,
      },
    });

    await db.update(projects).set({
      phase: 'literature_review',
      updatedAt: new Date(),
    }).where(eq(projects.id, project.id));

    this.log.info(`Project "${project.title}": found ${materialsCount} materials. Moving to literature_review.`);
  }

  private async projectLiteratureReview(
    project: typeof projects.$inferSelect,
    ctx: SubsystemContext,
  ): Promise<void> {
    this.log.info(`Project "${project.title}": reviewing literature...`);
    const db = getDb();
    const llm = this.llmFor('researcher', ctx);

    // Get relevant documents via keyword search. Combined into a single query
    // backed by trigram GIN indexes (#38). Drops content from the projection
    // since the LLM-facing prompt only consumes title/summary anyway.
    // LIKE metacharacters in keywords are escaped to prevent over-match (#28).
    const keywords = project.title.split(/\s+/).filter(w => w.length > 3);
    const keywordPatterns = keywords.map(k => `%${escapeLike(k)}%`);
    let allDocs: Array<{ title: string; content: string | null; author: string | null; summary: string | null }> = [];

    if (keywordPatterns.length > 0) {
      allDocs = await db
        .select({
          title: documents.title,
          content: documents.summary, // we only feed summary to the LLM; cheaper to fetch
          author: documents.author,
          summary: documents.summary,
        })
        .from(documents)
        .where(sql`${documents.title} ILIKE ANY(${keywordPatterns}) OR ${documents.content} ILIKE ANY(${keywordPatterns})`)
        .limit(15 * keywords.length);
    }

    // Also get semantic matches
    try {
      const semanticResults = await searchSimilar(project.title, 10);
      for (const result of semanticResults) {
        allDocs.push({
          title: result.content.slice(0, 100),
          content: result.content,
          author: null,
          summary: null,
        });
      }
    } catch {
      // Semantic search may not be available
    }

    // Deduplicate by title
    const seen = new Set<string>();
    const uniqueDocs = allDocs.filter(d => {
      if (seen.has(d.title)) return false;
      seen.add(d.title);
      return true;
    });

    const materialSummaries = uniqueDocs.map(m =>
      `- ${m.title}${m.author ? ` (${m.author})` : ''}: ${(m.summary || m.content || '').slice(0, 300)}`,
    ).join('\n');

    const litReviewPrompt = await loadPrompt(this.projectDir, 'literature-review');
    const prompt = LLM.formatPrompt(litReviewPrompt, {
      title: project.title,
      count: String(uniqueDocs.length),
      materials: materialSummaries || '(no materials found)',
    });

    const response = await llm.call(prompt);

    await db.update(projects).set({
      literatureReview: response.text,
      phase: 'identify_gaps',
      updatedAt: new Date(),
    }).where(eq(projects.id, project.id));

    await db.insert(researchLog).values({
      eventType: 'project_phase_complete',
      agentType: 'dispatcher',
      details: {
        projectId: project.id,
        title: project.title,
        phase: 'literature_review',
        reviewLength: response.text.length,
      },
    });

    this.log.info(`Project "${project.title}": literature review complete (${response.text.length} chars). Moving to identify_gaps.`);
  }

  private async projectIdentifyGaps(
    project: typeof projects.$inferSelect,
    ctx: SubsystemContext,
  ): Promise<void> {
    this.log.info(`Project "${project.title}": identifying research gaps...`);
    const db = getDb();
    const llm = this.llmFor('researcher', ctx);

    const gapsPrompt = await loadPrompt(this.projectDir, 'identify-gaps');
    const prompt = LLM.formatPrompt(gapsPrompt, {
      title: project.title,
      literatureReview: project.literatureReview || '(no review available)',
    });

    const response = await llm.callJSON<{
      gaps: Array<{ title: string; description: string; significance: string }>;
      suggestedTasks: Array<{ agentType: string; description: string; priority: number }>;
    }>(prompt);

    // Save gaps
    await db.update(projects).set({
      identifiedGaps: response.data.gaps,
      phase: 'research',
      updatedAt: new Date(),
    }).where(eq(projects.id, project.id));

    // Create tasks from gaps
    for (const task of response.data.suggestedTasks.slice(0, 5)) {
      await db.insert(agentTasks).values({
        agentType: task.agentType,
        status: 'pending',
        priority: task.priority,
        projectId: project.id,
        payload: { description: task.description },
      });
    }

    await db.insert(researchLog).values({
      eventType: 'project_phase_complete',
      agentType: 'dispatcher',
      details: {
        projectId: project.id,
        title: project.title,
        phase: 'identify_gaps',
        gaps: response.data.gaps.length,
        tasks: response.data.suggestedTasks.length,
      },
    });

    this.log.info(`Project "${project.title}": found ${response.data.gaps.length} gaps, created ${response.data.suggestedTasks.length} tasks. Moving to research.`);
  }

  private async projectResearch(
    project: typeof projects.$inferSelect,
    ctx: SubsystemContext,
  ): Promise<void> {
    const db = getDb();
    const llm = this.llmFor('researcher', ctx);
    const config = await this.getModuleConfig();

    // Check if we have enough findings to write a paper
    const [count] = await db
      .select({ count: sql<number>`count(*)` })
      .from(findings)
      .where(eq(findings.projectId, project.id));
    const findingCount = Number(count.count);

    await db.update(projects).set({ findingsCount: findingCount, updatedAt: new Date() })
      .where(eq(projects.id, project.id));

    if (findingCount >= (config.minFindings ?? 5)) {
      await db.update(projects).set({ phase: 'paper', updatedAt: new Date() })
        .where(eq(projects.id, project.id));
      this.log.info(`Project "${project.title}": ${findingCount} findings. Moving to paper.`);
      return;
    }

    // Need more research — generate tasks targeting the gaps
    const gaps = (project.identifiedGaps as Array<{ title: string; description: string }>) || [];
    if (gaps.length === 0) {
      await db.update(projects).set({ phase: 'identify_gaps', updatedAt: new Date() })
        .where(eq(projects.id, project.id));
      return;
    }

    const projectFindings = await db
      .select({ finding: findings.finding })
      .from(findings)
      .where(eq(findings.projectId, project.id))
      .limit(10);

    const genTasksPrompt = await loadPrompt(this.projectDir, 'project-generate-tasks');
    const prompt = LLM.formatPrompt(genTasksPrompt, {
      title: project.title,
      gaps: gaps.map((g, i) => `${i + 1}. ${g.title}: ${g.description}`).join('\n'),
      findingCount: String(findingCount),
      findings: projectFindings.map(f => `- ${f.finding.slice(0, 100)}`).join('\n'),
    });

    const response = await llm.callJSON<{
      tasks: Array<{ agentType: string; description: string; priority: number }>;
    }>(prompt);

    for (const task of response.data.tasks) {
      await db.insert(agentTasks).values({
        agentType: task.agentType,
        status: 'pending',
        priority: task.priority,
        projectId: project.id,
        payload: { description: task.description },
      });
    }

    this.log.info(`Project "${project.title}": generated ${response.data.tasks.length} tasks for ${findingCount} findings.`);
  }

  private async projectWritePaper(
    project: typeof projects.$inferSelect,
    ctx: SubsystemContext,
  ): Promise<void> {
    // Skip if paper already written
    if (project.paperDraft) return;

    this.log.info(`Project "${project.title}": writing paper...`);
    const db = getDb();
    const llm = this.llmFor('researcher', ctx);

    const projectFindings = await db
      .select()
      .from(findings)
      .where(eq(findings.projectId, project.id))
      .orderBy(desc(findings.createdAt))
      .limit(20);

    const paperPrompt = await loadPrompt(this.projectDir, 'write-project-paper');
    const prompt = LLM.formatPrompt(paperPrompt, {
      title: project.title,
      literatureReview: (project.literatureReview || '').slice(0, 3000),
      gaps: JSON.stringify(project.identifiedGaps, null, 2),
      findingCount: String(projectFindings.length),
      findings: projectFindings.map(f => `[${f.evidenceStrength}] ${f.finding}`).join('\n\n'),
    });

    const response = await llm.call(prompt);

    await db.update(projects).set({
      paperDraft: response.text,
      paperStatus: 'draft',
      updatedAt: new Date(),
    }).where(eq(projects.id, project.id));

    await db.insert(researchLog).values({
      eventType: 'project_phase_complete',
      agentType: 'dispatcher',
      details: {
        projectId: project.id,
        title: project.title,
        phase: 'paper',
        paperLength: response.text.length,
      },
    });

    this.log.info(`Project "${project.title}": paper written (${response.text.length} chars).`);
  }

  private getAgent(agentType: string, llm: LLM): BaseAgent {
    const cached = this.agents.get(agentType);
    if (cached) return cached;

    const agent = new PromptAgent(agentType, llm, this.projectDir);
    this.agents.set(agentType, agent);
    return agent;
  }
}
