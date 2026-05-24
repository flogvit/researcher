import { getDb } from '../db/connection';
import { agentTasks, researchLog } from '../db/schema';
import { eq } from 'drizzle-orm';
import type { ProjectConfig } from '../config';
import { Logger } from './logger';
import { ADMIN_PREFIX, claimNextTask } from './task-queue';
import { getAdminHandler } from './admin-handlers';

const log = new Logger('admin');

/**
 * Process pending admin tasks from the queue.
 *
 * Each admin task's agentType is `admin:<type>`; the `<type>` part is looked
 * up in the handler registry (src/core/admin-handlers), which owns the Zod
 * schema for payload validation, the risk level, and the handler itself.
 *
 * Returns the number of tasks processed in this pass.
 */
export async function processAdminTasks(config: ProjectConfig, projectDir: string): Promise<number> {
  const db = getDb();
  let processed = 0;

  while (true) {
    const task = await claimNextTask('admin');
    if (!task) break;

    const taskType = task.agentType.slice(ADMIN_PREFIX.length);
    const handler = getAdminHandler(taskType);

    try {
      if (!handler) {
        await db.update(agentTasks)
          .set({ status: 'failed', error: `Unknown admin task type: ${taskType}`, completedAt: new Date() })
          .where(eq(agentTasks.id, task.id));
        log.error(`Admin task ${task.id} unknown type: ${taskType}`);
        processed++;
        continue;
      }

      const parsed = handler.payloadSchema.safeParse(task.payload);
      if (!parsed.success) {
        const msg = `Invalid payload for ${taskType}: ${parsed.error.message}`;
        await db.update(agentTasks)
          .set({ status: 'failed', error: msg, completedAt: new Date() })
          .where(eq(agentTasks.id, task.id));
        log.error(`Admin task ${task.id} ${msg}`);
        processed++;
        continue;
      }

      const result = await handler.handle(parsed.data, { config, projectDir });

      await db.update(agentTasks)
        .set({ status: 'completed', result, completedAt: new Date() })
        .where(eq(agentTasks.id, task.id));

      await db.insert(researchLog).values({
        eventType: 'admin_task_completed',
        agentType: task.agentType,
        details: { taskId: task.id, riskLevel: handler.riskLevel, result },
      });

      log.info(`Admin task ${task.id} (${taskType}, ${handler.riskLevel}) completed`);
      processed++;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await db.update(agentTasks)
        .set({ status: 'failed', error: message, completedAt: new Date() })
        .where(eq(agentTasks.id, task.id));
      log.error(`Admin task ${task.id} failed: ${message}`);
      processed++;
    }
  }

  return processed;
}
