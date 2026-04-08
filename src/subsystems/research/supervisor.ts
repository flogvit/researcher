import { getDb } from '../../db/connection.js';
import { agentTasks, researchLog, findings } from '../../db/schema.js';
import { desc, sql, eq } from 'drizzle-orm';
import { LLM } from '../../llm/llm.js';
import { SUPERVISOR_DIAGNOSE } from '../../prompts/defaults.js';

interface SupervisorAction {
  type: 'delete_failed' | 'observation' | 'adjust_strategy';
  reason?: string;
  text?: string;
}

interface SupervisorResult {
  diagnosis: string;
  actions: SupervisorAction[];
  systemHealth: string;
  recommendations: string[];
}

export class Supervisor {
  private llm: LLM;

  constructor(llm: LLM) {
    this.llm = llm;
  }

  async check(): Promise<void> {
    const db = getDb();

    // Gather error stats
    const failedTasks = await db
      .select()
      .from(agentTasks)
      .where(eq(agentTasks.status, 'failed'))
      .orderBy(desc(agentTasks.completedAt))
      .limit(10);

    if (failedTasks.length === 0) {
      // No errors — just log health check
      const [taskStats] = await db.select({
        pending: sql<number>`count(*) filter (where status = 'pending')`,
        completed: sql<number>`count(*) filter (where status = 'completed')`,
      }).from(agentTasks);

      const [findingStats] = await db.select({
        count: sql<number>`count(*)`,
      }).from(findings);

      await db.insert(researchLog).values({
        eventType: 'supervisor_check',
        agentType: 'supervisor',
        details: {
          status: 'healthy',
          pending: Number(taskStats.pending),
          completed: Number(taskStats.completed),
          findings: Number(findingStats.count),
          errors: 0,
        },
      });
      return;
    }

    // We have errors — diagnose
    const errorSummaries = failedTasks.map(t => {
      const taskDesc = (t.payload as Record<string, unknown>)?.description
        ?? (t.payload as Record<string, unknown>)?.task ?? 'unknown';
      return `Task ${t.id} (${t.agentType}): ${String(taskDesc).slice(0, 100)} → ${(t.error ?? '').slice(0, 150)}`;
    }).join('\n');

    const [stats] = await db.select({
      pending: sql<number>`count(*) filter (where status = 'pending')`,
      completed: sql<number>`count(*) filter (where status = 'completed')`,
      failed: sql<number>`count(*) filter (where status = 'failed')`,
    }).from(agentTasks);

    const [findingStats] = await db.select({
      count: sql<number>`count(*)`,
    }).from(findings);

    const prompt = LLM.formatPrompt(SUPERVISOR_DIAGNOSE, {
      errors: errorSummaries,
      completed: String(stats.completed),
      failed: String(stats.failed),
      pending: String(stats.pending),
      findings: String(findingStats.count),
    });

    try {
      const response = await this.llm.callJSON<SupervisorResult>(prompt);
      const result = response.data;

      // Execute actions
      for (const action of result.actions) {
        if (action.type === 'delete_failed') {
          // Clean up persistently failing tasks
          const deleted = await db.delete(agentTasks)
            .where(eq(agentTasks.status, 'failed'))
            .returning();
          console.log(`Supervisor: deleted ${deleted.length} failed tasks. ${action.reason}`);
        }
      }

      await db.insert(researchLog).values({
        eventType: 'supervisor_check',
        agentType: 'supervisor',
        details: {
          diagnosis: result.diagnosis,
          systemHealth: result.systemHealth,
          actions: result.actions,
          recommendations: result.recommendations,
          errorsFound: failedTasks.length,
        },
      });

      console.log(`Supervisor: ${result.systemHealth} — ${result.diagnosis}`);
    } catch (e) {
      console.error('Supervisor check failed:', e instanceof Error ? e.message : e);
    }
  }
}
