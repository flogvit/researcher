import { getDb } from '../db/connection';
import { reviewFeedback, agentTasks, researchLog } from '../db/schema';
import { eq, desc, sql, inArray } from 'drizzle-orm';
import { LLM } from '../llm/llm';
import { loadPrompt } from './prompt-loader';
import { Logger } from './logger';
import type { ModuleConfig } from './module-config';
import { atomicWrite } from './upgrade';
import { assertWithinProject } from './admin-handlers/safe-path';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const DEFAULT_REVIEW_THRESHOLD = 10;

/**
 * Whether a learner-proposed target name is safe to use as a prompt filename.
 *
 * The learner consumes feedback derived from attacker-influenced documents
 * (the classifier and reviewer both read raw document text). If a hostile
 * document convinces the LLM to emit `proposal.target = "../../etc/passwd"`,
 * we would silently overwrite that file. Belt-and-braces: charset whitelist
 * here, assertWithinProject() at the resolve-site (#7).
 */
function isSafeTarget(target: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(target);
}

interface Proposal {
  type: 'modify_prompt' | 'add_agent' | 'modify_config';
  target: string;
  description: string;
  reasoning: string;
  newContent?: string;
}

interface AnalysisResult {
  patterns: string[];
  proposals: Proposal[];
}

interface CompareResult {
  winner: 'A' | 'B' | 'tie';
  reasoning: string;
}

export class Learner {
  private llm: LLM;
  private projectDir: string;
  private log = new Logger('learner');
  private config?: ModuleConfig;

  constructor(llm: LLM, projectDir: string, config?: ModuleConfig) {
    this.llm = llm;
    this.projectDir = projectDir;
    this.config = config;
  }

  /**
   * Check if enough reviews have accumulated and run learning if so.
   * Returns true if learning was triggered.
   */
  async maybeLearn(): Promise<boolean> {
    const db = getDb();

    const [count] = await db
      .select({ count: sql<number>`count(*)` })
      .from(reviewFeedback)
      .where(eq(reviewFeedback.processedByLearner, false));

    const threshold = this.config?.reviewThreshold ?? DEFAULT_REVIEW_THRESHOLD;
    if (Number(count.count) < threshold) return false;

    this.log.info(`${count.count} unprocessed reviews — running learning cycle`);
    await this.learn();
    return true;
  }

  /**
   * Force a learning cycle regardless of threshold.
   * Returns true if there were any reviews to process.
   */
  async forceLearn(): Promise<boolean> {
    const db = getDb();
    const [count] = await db
      .select({ count: sql<number>`count(*)` })
      .from(reviewFeedback)
      .where(eq(reviewFeedback.processedByLearner, false));

    if (Number(count.count) === 0) return false;

    this.log.info(`Force learning: ${count.count} unprocessed reviews`);
    await this.learn();
    return true;
  }

  private async learn(): Promise<void> {
    const db = getDb();

    // 1. Load unprocessed feedback
    const feedback = await db
      .select()
      .from(reviewFeedback)
      .where(eq(reviewFeedback.processedByLearner, false))
      .orderBy(desc(reviewFeedback.createdAt));

    // 2. Format reviews for analysis
    const reviewSummaries = feedback.map(f =>
      `Paper: "${f.paperTitle}" | Verdict: ${f.verdict} | Quality: ${f.quality}\n` +
      `  Strengths: ${JSON.stringify(f.strengths)}\n` +
      `  Weaknesses: ${JSON.stringify(f.weaknesses)}\n` +
      `  Required revisions: ${JSON.stringify(f.requiredRevisions)}`
    ).join('\n\n');

    // 3. Load current prompts for context
    const promptsDir = resolve(this.projectDir, 'research', 'prompts');
    let currentPromptsList = '(no project prompts found)';
    if (existsSync(promptsDir)) {
      const { Glob } = await import('bun');
      const glob = new Glob('*.md');
      const names: string[] = [];
      for await (const file of glob.scan(promptsDir)) {
        names.push(file.replace(/\.md$/, ''));
      }
      currentPromptsList = names.join(', ');
    }

    // 4. Analyze patterns
    this.log.info('Analyzing review patterns...');
    const analyzePrompt = await loadPrompt(this.projectDir, 'learner-analyze');
    const analysis = await this.llm.callJSON<AnalysisResult>(
      LLM.formatPrompt(analyzePrompt, {
        count: String(feedback.length),
        reviews: reviewSummaries,
        currentPrompts: currentPromptsList,
      })
    );

    this.log.info(`Found ${analysis.data.patterns.length} patterns, ${analysis.data.proposals.length} proposals`);

    await db.insert(researchLog).values({
      eventType: 'learner_analysis',
      agentType: 'learner',
      details: {
        reviewCount: feedback.length,
        patterns: analysis.data.patterns,
        proposalCount: analysis.data.proposals.length,
      },
    });

    // 5. A/B test each proposal
    let applied = 0;
    let rejected = 0;

    for (const proposal of analysis.data.proposals) {
      if (!isSafeTarget(proposal.target)) {
        this.log.warn(`Rejected proposal with unsafe target: ${JSON.stringify(proposal.target)}`);
        await db.insert(researchLog).values({
          eventType: 'learner_proposal_rejected',
          agentType: 'learner',
          details: { reason: 'unsafe_target', target: proposal.target, description: proposal.description },
        });
        rejected++;
        continue;
      }

      const ok = await this.handleProposal(proposal);
      if (ok) applied++; else rejected++;
    }

    // 6. Mark feedback as processed (#45 — single bulk UPDATE, not N round-trips)
    const feedbackIds = feedback.map(f => f.id);
    if (feedbackIds.length > 0) {
      await db.update(reviewFeedback)
        .set({ processedByLearner: true })
        .where(inArray(reviewFeedback.id, feedbackIds));
    }

    await db.insert(researchLog).values({
      eventType: 'learner_complete',
      agentType: 'learner',
      details: {
        reviewsProcessed: feedback.length,
        proposals: analysis.data.proposals.length,
        applied,
        rejected,
      },
    });

    this.log.info(`Learning complete: ${applied} changes applied, ${rejected} rejected`);
  }

  /**
   * Dispatch a proposal to its type-specific handler (#64). Each handler
   * returns true on successful apply, false on rejection. Adding a new
   * proposal type is a new private method + an entry in the switch.
   */
  private async handleProposal(proposal: Proposal): Promise<boolean> {
    switch (proposal.type) {
      case 'modify_prompt':
        return proposal.newContent ? this.testProposal(proposal) : false;
      case 'add_agent':
        return proposal.newContent ? this.applyAddAgent(proposal) : false;
      case 'modify_config':
        return this.logConfigProposal(proposal);
      default:
        this.log.info(`Skipping unsupported proposal: ${proposal.type} ${proposal.target}`);
        return false;
    }
  }

  private async applyAddAgent(proposal: Proposal): Promise<boolean> {
    if (!proposal.newContent) return false;
    const promptPath = resolve(this.projectDir, 'research', 'prompts', `${proposal.target}.md`);
    assertWithinProject(promptPath, this.projectDir);
    if (existsSync(promptPath)) {
      this.log.info(`Agent ${proposal.target} already exists, skipping`);
      return false;
    }
    await atomicWrite(promptPath, proposal.newContent);
    this.log.info(`Added new agent prompt: ${proposal.target}`);
    return true;
  }

  private async logConfigProposal(proposal: Proposal): Promise<boolean> {
    const db = getDb();
    this.log.info(`Config modification proposed: ${proposal.target} — ${proposal.description} (requires manual review)`);
    await db.insert(researchLog).values({
      eventType: 'learner_config_proposal',
      agentType: 'learner',
      details: { proposal: proposal.description, target: proposal.target, reasoning: proposal.reasoning },
    });
    return false; // never auto-applied
  }

  /**
   * Test a single proposal by A/B comparing old vs new prompt on a recent task.
   * Returns true if the proposal was applied.
   */
  private async testProposal(proposal: Proposal): Promise<boolean> {
    const db = getDb();
    this.log.info(`Testing proposal: ${proposal.description}`);

    // Find a recent completed task to re-run
    const [recentTask] = await db
      .select()
      .from(agentTasks)
      .where(eq(agentTasks.status, 'completed'))
      .orderBy(desc(agentTasks.completedAt))
      .limit(1);

    if (!recentTask) {
      this.log.warn('No completed tasks to test against');
      return false;
    }

    const taskDescription = (recentTask.payload as Record<string, unknown>)?.description
      ?? (recentTask.payload as Record<string, unknown>)?.task ?? 'unknown';

    // Get old prompt result (from the stored result)
    const oldResult = (recentTask.result as Record<string, unknown>)?.finding as string
      ?? JSON.stringify(recentTask.result);

    // Run with new prompt
    let newResult: string;
    try {
      const resp = await this.llm.call(`${proposal.newContent}\n\nTask: ${taskDescription}`);
      newResult = resp.text;
    } catch (e) {
      this.log.error(`Failed to run with new prompt: ${e instanceof Error ? e.message : e}`);
      return false;
    }

    // Blind comparison — randomize order
    const aIsOld = Math.random() > 0.5;
    const resultA = aIsOld ? oldResult : newResult;
    const resultB = aIsOld ? newResult : oldResult;

    const comparePrompt = await loadPrompt(this.projectDir, 'learner-compare');
    try {
      const comparison = await this.llm.callJSON<CompareResult>(
        LLM.formatPrompt(comparePrompt, {
          task: String(taskDescription),
          resultA,
          resultB,
        })
      );

      const newWon = (aIsOld && comparison.data.winner === 'B')
        || (!aIsOld && comparison.data.winner === 'A');

      await db.insert(researchLog).values({
        eventType: 'learner_ab_test',
        agentType: 'learner',
        details: {
          proposal: proposal.description,
          target: proposal.target,
          winner: comparison.data.winner,
          newWon,
          reasoning: comparison.data.reasoning,
        },
      });

      if (newWon && proposal.newContent) {
        // testProposal is reachable from learn() so the target charset was
        // already vetted, but check again at the write-site for symmetry.
        if (!isSafeTarget(proposal.target)) return false;
        const promptPath = resolve(this.projectDir, 'research', 'prompts', `${proposal.target}.md`);
        assertWithinProject(promptPath, this.projectDir);
        await atomicWrite(promptPath, proposal.newContent);
        this.log.info(`Applied: ${proposal.target} — ${proposal.description}`);
        return true;
      } else {
        this.log.info(`Rejected: ${proposal.target} — new prompt was not better`);
        return false;
      }
    } catch (e) {
      this.log.error(`Comparison failed: ${e instanceof Error ? e.message : e}`);
      return false;
    }
  }
}
