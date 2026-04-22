import type { SubsystemContext } from '../../core/subsystem';
import type { ModuleConfig } from '../../core/module-config';
import { loadModuleConfig } from '../../core/prompt-loader';
import { getDb } from '../../db/connection';
import { discoveries } from '../../db/schema';
import { sql } from 'drizzle-orm';
import { LLM, RateLimitError, createLLM } from '../../llm/llm';
import { Logger } from '../../core/logger';
import { PaperPipeline } from './pipeline';
import { Learner } from '../../core/learner';

export class PaperDispatcher {
  private running = false;
  private tickInterval = 5000;
  private log = new Logger('paper');
  private learner: Learner | null = null;
  private moduleConfig: ModuleConfig | null = null;

  private async getModuleConfig(): Promise<ModuleConfig> {
    if (!this.moduleConfig) {
      this.moduleConfig = await loadModuleConfig(process.cwd(), 'paper');
    }
    return this.moduleConfig;
  }

  async start(ctx: SubsystemContext): Promise<void> {
    this.running = true;
    const config = await this.getModuleConfig();
    this.tickInterval = config.tickInterval ?? 5000;
    const llm = createLLM('paper', ctx.config.llm, ctx.config.agents);
    this.learner = new Learner(llm, process.cwd(), config);
    this.log.info('Paper dispatcher started');

    while (this.running) {
      try {
        await this.tick(ctx, this.learner);
      } catch (e) {
        if (e instanceof RateLimitError) {
          const cap = config.rateLimitRecoveryCap ?? 60000;
          this.log.warn(`Rate limited. Waiting ${Math.ceil(e.waitMs / 60000)} min...`);
          await Bun.sleep(Math.min(e.waitMs, cap));
        } else {
          this.log.error(`Tick error: ${e instanceof Error ? e.message : e}`);
        }
      }
      await Bun.sleep(this.tickInterval);
    }

    this.log.info('Paper dispatcher stopped');
  }

  async runOnce(ctx: SubsystemContext): Promise<void> {
    this.log.info('Running paper pipeline (one pass)');
    const config = await this.getModuleConfig();
    const llm = createLLM('learner', ctx.config.llm, ctx.config.agents);
    const learner = new Learner(llm, process.cwd(), config);
    await this.tick(ctx, learner);
    await learner.maybeLearn();
    this.log.info('Paper pass complete');
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  private async tick(ctx: SubsystemContext, learner: Learner | null = null): Promise<void> {
    if (LLM.isCurrentlyRateLimited()) return;

    const db = getDb();
    const llm = createLLM('paper', ctx.config.llm, ctx.config.agents);
    const projectDir = process.cwd();
    const pipeline = new PaperPipeline(llm, projectDir);

    // 1. Domain review for pending discoveries
    const [pendingReview] = await db
      .select()
      .from(discoveries)
      .where(sql`${discoveries.status} = 'pending_domain_review'`)
      .limit(1);

    if (pendingReview) {
      await pipeline.domainReview(pendingReview);
      return;
    }

    // 2. Write paper for reviewed discoveries
    const [pendingPaper] = await db
      .select()
      .from(discoveries)
      .where(sql`${discoveries.status} = 'pending_paper'`)
      .limit(1);

    if (pendingPaper) {
      await pipeline.writePaper(pendingPaper);
      return;
    }

    // 3. Review and revise draft papers
    const [draftPaper] = await db
      .select()
      .from(discoveries)
      .where(sql`${discoveries.paperStatus} = 'draft' AND ${discoveries.paper} IS NOT NULL`)
      .limit(1);

    if (draftPaper) {
      await pipeline.reviewAndRevise(draftPaper);
      if (learner) await learner.maybeLearn();
      return;
    }
  }
}
