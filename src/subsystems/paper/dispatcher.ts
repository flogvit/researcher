import type { SubsystemContext } from '../../core/subsystem';
import type { ModuleConfig } from '../../core/module-config';
import { getDb } from '../../db/connection';
import { discoveries } from '../../db/schema';
import { sql } from 'drizzle-orm';
import { LLM, createLLM } from '../../llm/llm';
import { BaseDispatcher } from '../../core/base-dispatcher';
import { PaperPipeline } from './pipeline';
import { Learner } from '../../core/learner';

export class PaperDispatcher extends BaseDispatcher {
  private learner: Learner | null = null;

  constructor() {
    super('paper', 5000);
  }

  async start(ctx: SubsystemContext): Promise<void> {
    const config = await this.getModuleConfig();
    const llm = createLLM('paper', ctx.config.llm, ctx.config.agents);
    this.learner = new Learner(llm, process.cwd(), config);
    await super.start(ctx);
  }

  async runOnce(ctx: SubsystemContext): Promise<void> {
    this.log.info('Running paper pipeline (one pass)');
    const config = await this.getModuleConfig();
    const llm = createLLM('learner', ctx.config.llm, ctx.config.agents);
    const learner = new Learner(llm, process.cwd(), config);
    await this.tickWithLearner(ctx, learner);
    await learner.maybeLearn();
    this.log.info('Paper pass complete');
  }

  protected async tick(ctx: SubsystemContext, _config: ModuleConfig): Promise<void> {
    await this.tickWithLearner(ctx, this.learner);
  }

  private async tickWithLearner(ctx: SubsystemContext, learner: Learner | null): Promise<void> {
    if (LLM.isCurrentlyRateLimited()) return;

    const db = getDb();
    const llm = createLLM('paper', ctx.config.llm, ctx.config.agents);
    const projectDir = process.cwd();
    const pipeline = new PaperPipeline(llm, projectDir);

    const [pendingReview] = await db
      .select()
      .from(discoveries)
      .where(sql`${discoveries.status} = 'pending_domain_review'`)
      .limit(1);
    if (pendingReview) {
      await pipeline.domainReview(pendingReview);
      return;
    }

    const [pendingPaper] = await db
      .select()
      .from(discoveries)
      .where(sql`${discoveries.status} = 'pending_paper'`)
      .limit(1);
    if (pendingPaper) {
      await pipeline.writePaper(pendingPaper);
      return;
    }

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
