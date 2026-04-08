import type { Subsystem, SubsystemContext, SubsystemStatus } from '../../core/subsystem.js';
import { LibraryDispatcher } from './dispatcher.js';
import { getDb } from '../../db/connection.js';
import { documents } from '../../db/schema.js';
import { sql } from 'drizzle-orm';

export class LibrarySubsystem implements Subsystem {
  readonly name = 'library';
  readonly dependencies: string[] = [];
  private dispatcher = new LibraryDispatcher();

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

    const counts = await db
      .select({
        status: documents.status,
        count: sql<number>`count(*)`,
      })
      .from(documents)
      .groupBy(documents.status);

    const stats: Record<string, number | string> = {};
    let total = 0;
    for (const row of counts) {
      stats[row.status] = Number(row.count);
      total += Number(row.count);
    }
    stats.total = total;

    return {
      name: 'library',
      state: 'idle',
      ready: total > 0,
      stats,
      lastActivity: null,
      error: null,
    };
  }
}
