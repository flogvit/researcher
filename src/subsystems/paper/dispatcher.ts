import type { SubsystemContext } from '../../core/subsystem.js';
import { getDb } from '../../db/connection.js';
import { discoveries } from '../../db/schema.js';
import { sql } from 'drizzle-orm';
import { LLM, RateLimitError } from '../../llm/llm.js';
import { Logger } from '../../core/logger.js';
import { PaperPipeline } from './pipeline.js';

export class PaperDispatcher {
  private running = false;
  private tickInterval = 5000;
  private log = new Logger('paper');

  async start(ctx: SubsystemContext): Promise<void> {
    this.running = true;
    this.log.info('Paper dispatcher started');

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

    this.log.info('Paper dispatcher stopped');
  }

  async runOnce(ctx: SubsystemContext): Promise<void> {
    this.log.info('Running paper pipeline (one pass)');
    await this.tick(ctx);
    this.log.info('Paper pass complete');
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  private async tick(ctx: SubsystemContext): Promise<void> {
    if (LLM.isCurrentlyRateLimited()) return;

    const db = getDb();
    const llm = new LLM(ctx.config.llm);
    const pipeline = new PaperPipeline(llm);

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
      return;
    }
  }
}
