import type { Subsystem, SubsystemContext, SubsystemStatus } from '../../core/subsystem.js';
import { ResearchDispatcher } from './dispatcher.js';
import { getDb } from '../../db/connection.js';
import { agentTasks, findings } from '../../db/schema.js';
import { sql } from 'drizzle-orm';

export class ResearchSubsystem implements Subsystem {
  readonly name = 'research';
  readonly dependencies = ['library'];
  private dispatcher = new ResearchDispatcher();

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

    const [taskCounts] = await db.select({
      pending: sql<number>`count(*) filter (where status = 'pending')`,
      inProgress: sql<number>`count(*) filter (where status = 'in_progress')`,
      completed: sql<number>`count(*) filter (where status = 'completed')`,
      failed: sql<number>`count(*) filter (where status = 'failed')`,
    }).from(agentTasks);

    const [findingCount] = await db.select({
      count: sql<number>`count(*)`,
    }).from(findings);

    return {
      name: 'research',
      state: 'idle',
      ready: true,
      stats: {
        pending: Number(taskCounts.pending),
        in_progress: Number(taskCounts.inProgress),
        completed: Number(taskCounts.completed),
        failed: Number(taskCounts.failed),
        findings: Number(findingCount.count),
      },
      lastActivity: null,
      error: null,
    };
  }
}
