import type { SubsystemContext } from '../../core/subsystem.js';
import { getDb } from '../../db/connection.js';
import { agentTasks, findings, researchLog, projects, documents, embeddings } from '../../db/schema.js';
import { eq, desc, sql, asc, and } from 'drizzle-orm';
import { LLM, RateLimitError } from '../../llm/llm.js';
import { Logger } from '../../core/logger.js';
import { Triage } from './triage.js';
import { Reviewer } from './reviewer.js';
import { Reflector } from './reflector.js';
import { TaskGenerator } from './task-generator.js';
import { Supervisor } from './supervisor.js';
import { PromptAgent } from './agents/prompt-agent.js';
import type { BaseAgent } from './agents/base-agent.js';
import { resolve } from 'node:path';
import { searchSimilar } from '../../llm/embeddings.js';
import {
  LITERATURE_REVIEW,
  IDENTIFY_GAPS,
  PROJECT_GENERATE_TASKS,
  WRITE_PROJECT_PAPER,
} from '../../prompts/project.js';

export class ResearchDispatcher {
  private running = false;
  private tickInterval = 2000;
  private tasksSinceReflection = 0;
  private lastSupervisorTime = 0;
  private lastGenerateTime = 0;
  private agents: Map<string, BaseAgent> = new Map();
  private log = new Logger('research');

  async start(ctx: SubsystemContext): Promise<void> {
    this.running = true;
    this.log.info('Research dispatcher started');

    while (this.running) {
      try {
        await this.tick(ctx);
      } catch (e) {
        if (e instanceof RateLimitError) {
          this.log.warn(`Rate limited. Waiting ${Math.ceil(e.waitMs / 60000)} min...`);
          await Bun.sleep(Math.min(e.waitMs, 60000));
        } else {
          this.log.error(`Tick error: ${e instanceof Error ? e.message : e}`);
        }
      }
      await Bun.sleep(this.tickInterval);
    }

    this.log.info('Research dispatcher stopped');
  }

  async runOnce(ctx: SubsystemContext): Promise<void> {
    this.log.info('Running research (one pass)');

    // Process all pending tasks
    let processed = true;
    while (processed) {
      processed = await this.processOneTask(ctx);
    }

    // Check project phases
    await this.checkProjects(ctx);

    // Reflect if needed
    if (this.tasksSinceReflection > 0) {
      await this.runReflection(ctx);
    }

    this.log.info('Research pass complete');
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  private async tick(ctx: SubsystemContext): Promise<void> {
    if (LLM.isCurrentlyRateLimited()) return;

    const now = Date.now();

    // Try to process a task
    const didWork = await this.processOneTask(ctx);

    if (!didWork) {
      // No tasks — maybe reflect
      if (this.tasksSinceReflection >= (ctx.config.research?.reflectEvery ?? 3)) {
        await this.runReflection(ctx);
        return;
      }

      // Or generate work
      await this.runGenerateWork(ctx);
    }

    // Check project phases
    await this.checkProjects(ctx);

    // Supervisor every 5 min
    if (now - this.lastSupervisorTime > 300_000) {
      this.lastSupervisorTime = now;
      await this.runSupervisor(ctx);
    }
  }

  private async processOneTask(ctx: SubsystemContext): Promise<boolean> {
    const db = getDb();
    const llm = new LLM(ctx.config.llm);
    const projectDir = process.cwd();

    // Pick oldest pending task
    const [task] = await db
      .select()
      .from(agentTasks)
      .where(eq(agentTasks.status, 'pending'))
      .orderBy(asc(agentTasks.createdAt))
      .limit(1);

    if (!task) return false;

    const taskDescription = (task.payload as Record<string, unknown>)?.description
      ?? (task.payload as Record<string, unknown>)?.task ?? 'unknown task';

    // Mark in_progress
    await db.update(agentTasks)
      .set({ status: 'in_progress', startedAt: new Date() })
      .where(eq(agentTasks.id, task.id));

    // Triage (skip for split children)
    const isSplitChild = (task.payload as Record<string, unknown>)?.fromSplit === true;
    if (!isSplitChild) {
      try {
        const triage = new Triage(llm);
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
    try {
      const agent = this.getAgent(task.agentType, llm, projectDir);
      const result = await agent.execute(task.payload as Record<string, unknown>);

      // Review
      let reviewQuality = 'unreviewed';
      try {
        const reviewer = new Reviewer(llm);
        const review = await reviewer.review(String(taskDescription), result);
        reviewQuality = review.quality;
        if (!review.approved) {
          result.evidenceStrength = 'speculation';
        }
      } catch {
        // Review failed, keep original strength
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
      if (error instanceof RateLimitError) throw error;

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

  private async runReflection(ctx: SubsystemContext): Promise<void> {
    const db = getDb();
    const llm = new LLM(ctx.config.llm);
    const projectDir = process.cwd();
    const agentTypes = ctx.config.research?.agentTypes ?? [];
    const strategyPath = resolve(projectDir, ctx.config.research?.strategyFile ?? 'research/strategy.md');

    this.tasksSinceReflection = 0;

    const reflector = new Reflector(llm, strategyPath);
    const recentFindings = await db.select().from(findings).orderBy(desc(findings.createdAt)).limit(10);

    const reflection = await reflector.reflect(
      recentFindings.map(f => ({ agentType: f.agentType, result: f.finding })),
      agentTypes,
    );

    for (const next of reflection.nextTasks.slice(0, 3)) {
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

    // 5-minute cooldown
    if (now - this.lastGenerateTime < 300_000) return;
    this.lastGenerateTime = now;

    const llm = new LLM(ctx.config.llm);
    const projectDir = process.cwd();
    const agentTypes = ctx.config.research?.agentTypes ?? [];
    const strategyPath = resolve(projectDir, ctx.config.research?.strategyFile ?? 'research/strategy.md');

    const recentFindings = await db
      .select({ finding: findings.finding })
      .from(findings)
      .orderBy(desc(findings.createdAt))
      .limit(10);

    const generator = new TaskGenerator(llm, strategyPath);
    const result = await generator.generate(
      recentFindings.map(f => f.finding),
      null,
      agentTypes,
    );

    for (const task of result.tasks.slice(0, 5)) {
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
    const llm = new LLM(ctx.config.llm);
    const supervisor = new Supervisor(llm);
    await supervisor.check();
  }

  private async checkProjects(ctx: SubsystemContext): Promise<void> {
    if (LLM.isCurrentlyRateLimited()) return;

    const db = getDb();

    // Find active projects that have no pending/in_progress tasks with their projectId
    const activeProjects = await db
      .select()
      .from(projects)
      .where(eq(projects.status, 'active'));

    for (const project of activeProjects) {
      // Check if project has pending or in_progress tasks
      const [taskCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(agentTasks)
        .where(
          and(
            eq(agentTasks.projectId, project.id),
            sql`${agentTasks.status} IN ('pending', 'in_progress')`,
          ),
        );

      if (Number(taskCount.count) > 0) continue;

      // No active tasks — advance the phase
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
    let semanticResults: Array<{ sourceId: number | null }> = [];
    try {
      semanticResults = await searchSimilar(project.title, 20);
    } catch (e) {
      this.log.warn(`Semantic search failed: ${e instanceof Error ? e.message : e}`);
    }

    // Keyword search on documents
    const keywords = project.title.split(/\s+/).filter(w => w.length > 3);
    const keywordConditions = keywords.map(k => `%${k}%`);

    let keywordDocs: Array<{ id: number }> = [];
    for (const pattern of keywordConditions) {
      const results = await db
        .select({ id: documents.id })
        .from(documents)
        .where(sql`(${documents.title} ILIKE ${pattern} OR ${documents.content} ILIKE ${pattern})`)
        .limit(20);
      keywordDocs.push(...results);
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
    const llm = new LLM(ctx.config.llm);

    // Get relevant documents via keyword search
    const keywords = project.title.split(/\s+/).filter(w => w.length > 3);
    const allDocs: Array<{ title: string; content: string | null; author: string | null; summary: string | null }> = [];

    for (const keyword of keywords) {
      const docs = await db
        .select({
          title: documents.title,
          content: documents.content,
          author: documents.author,
          summary: documents.summary,
        })
        .from(documents)
        .where(sql`(${documents.title} ILIKE ${'%' + keyword + '%'} OR ${documents.content} ILIKE ${'%' + keyword + '%'})`)
        .limit(15);
      allDocs.push(...docs);
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

    const prompt = LLM.formatPrompt(LITERATURE_REVIEW, {
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
    const llm = new LLM(ctx.config.llm);

    const prompt = LLM.formatPrompt(IDENTIFY_GAPS, {
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
    const llm = new LLM(ctx.config.llm);

    // Check if we have enough findings to write a paper
    const [count] = await db
      .select({ count: sql<number>`count(*)` })
      .from(findings)
      .where(eq(findings.projectId, project.id));
    const findingCount = Number(count.count);

    await db.update(projects).set({ findingsCount: findingCount, updatedAt: new Date() })
      .where(eq(projects.id, project.id));

    if (findingCount >= 5) {
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

    const prompt = LLM.formatPrompt(PROJECT_GENERATE_TASKS, {
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
    const llm = new LLM(ctx.config.llm);

    const projectFindings = await db
      .select()
      .from(findings)
      .where(eq(findings.projectId, project.id))
      .orderBy(desc(findings.createdAt))
      .limit(20);

    const prompt = LLM.formatPrompt(WRITE_PROJECT_PAPER, {
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

  private getAgent(agentType: string, llm: LLM, projectDir: string): BaseAgent {
    const cached = this.agents.get(agentType);
    if (cached) return cached;

    const agent = new PromptAgent(agentType, llm, projectDir);
    this.agents.set(agentType, agent);
    return agent;
  }
}
