import { NextResponse } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { agentTasks, findings } from '@researcher/db/schema';
import { sql } from 'drizzle-orm';
import { LLM } from '@researcher/llm/llm';

export async function GET() {
  try {
    const { db } = await getServerContext();

    const [taskCounts] = await db.select({
      pending: sql<number>`count(*) filter (where status = 'pending')`,
      inProgress: sql<number>`count(*) filter (where status = 'in_progress')`,
      completed: sql<number>`count(*) filter (where status = 'completed')`,
      failed: sql<number>`count(*) filter (where status = 'failed')`,
    }).from(agentTasks);

    const [findingCount] = await db.select({
      count: sql<number>`count(*)`,
    }).from(findings);

    return NextResponse.json({
      tasks: {
        pending: Number(taskCounts.pending),
        inProgress: Number(taskCounts.inProgress),
        completed: Number(taskCounts.completed),
        failed: Number(taskCounts.failed),
      },
      findings: Number(findingCount.count),
      rateLimited: LLM.isCurrentlyRateLimited(),
      rateLimitWaitMs: LLM.getRateLimitWaitMs(),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
