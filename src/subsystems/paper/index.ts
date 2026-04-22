import type { Subsystem, SubsystemContext, SubsystemStatus } from '../../core/subsystem';
import { PaperDispatcher } from './dispatcher';
import { getDb } from '../../db/connection';
import { discoveries } from '../../db/schema';
import { sql } from 'drizzle-orm';

export class PaperSubsystem implements Subsystem {
  readonly name = 'paper';
  readonly dependencies = ['discovery'];
  private dispatcher = new PaperDispatcher();

  async start(ctx: SubsystemContext): Promise<void> {
    await this.dispatcher.start(ctx);
  }

  async update(ctx: SubsystemContext): Promise<void> {
    await this.dispatcher.runOnce(ctx);
  }

  async stop(): Promise<void> {
    await this.dispatcher.stop();
  }

  async status(): Promise<SubsystemStatus> {
    const db = getDb();

    const [counts] = await db.select({
      pendingReview: sql<number>`count(*) filter (where status = 'pending_domain_review')`,
      pendingPaper: sql<number>`count(*) filter (where status = 'pending_paper')`,
      paperWritten: sql<number>`count(*) filter (where status = 'paper_written')`,
      approved: sql<number>`count(*) filter (where paper_status = 'approved')`,
      revised: sql<number>`count(*) filter (where paper_status = 'revised')`,
      rejected: sql<number>`count(*) filter (where paper_status = 'rejected')`,
      draft: sql<number>`count(*) filter (where paper_status = 'draft')`,
      failedOriginality: sql<number>`count(*) filter (where paper_status = 'failed_originality')`,
    }).from(discoveries);

    return {
      name: 'paper',
      state: 'idle',
      ready: true,
      stats: {
        pending_review: Number(counts.pendingReview),
        pending_paper: Number(counts.pendingPaper),
        paper_written: Number(counts.paperWritten),
        draft: Number(counts.draft),
        approved: Number(counts.approved),
        revised: Number(counts.revised),
        rejected: Number(counts.rejected),
        failed_originality: Number(counts.failedOriginality),
      },
      lastActivity: null,
      error: null,
    };
  }
}
