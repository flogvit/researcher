import type { Subsystem, SubsystemContext, SubsystemStatus } from '../../core/subsystem.js';
import { DiscoveryDispatcher } from './dispatcher.js';
import { getDb } from '../../db/connection.js';
import { discoveries } from '../../db/schema.js';
import { sql } from 'drizzle-orm';

export class DiscoverySubsystem implements Subsystem {
  readonly name = 'discovery';
  readonly dependencies = ['research'];
  private dispatcher = new DiscoveryDispatcher();

  async start(ctx: SubsystemContext): Promise<void> {
    await this.dispatcher.start(ctx);
  }

  async update(ctx: SubsystemContext): Promise<void> {
    // Single-pass mode not needed for discovery — it runs on its own schedule
  }

  async stop(): Promise<void> {
    await this.dispatcher.stop();
  }

  async status(): Promise<SubsystemStatus> {
    const db = getDb();

    const [counts] = await db.select({
      total: sql<number>`count(*)`,
      pendingVerification: sql<number>`count(*) filter (where status = 'pending_verification')`,
      pendingDomainReview: sql<number>`count(*) filter (where status = 'pending_domain_review')`,
      notNovel: sql<number>`count(*) filter (where status = 'not_novel')`,
      alreadyPublished: sql<number>`count(*) filter (where status = 'already_published')`,
      pendingPaper: sql<number>`count(*) filter (where status = 'pending_paper')`,
      paperWritten: sql<number>`count(*) filter (where status = 'paper_written')`,
    }).from(discoveries);

    return {
      name: 'discovery',
      state: 'idle',
      ready: true,
      stats: {
        total: Number(counts.total),
        pending_verification: Number(counts.pendingVerification),
        pending_domain_review: Number(counts.pendingDomainReview),
        not_novel: Number(counts.notNovel),
        already_published: Number(counts.alreadyPublished),
        pending_paper: Number(counts.pendingPaper),
        paper_written: Number(counts.paperWritten),
      },
      lastActivity: null,
      error: null,
    };
  }
}
