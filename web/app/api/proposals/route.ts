import { NextResponse } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { agentTasks } from '@researcher/db/schema';
import { sql, desc } from 'drizzle-orm';

/**
 * Proposal queue (Fase 2 #89). Lists admin tasks that came from brief-mode
 * chat and are either:
 *   - 'blocked' (high-risk, awaiting explicit approval)
 *   - 'pending' but with payload._proposal.autoApproved=false (medium-risk
 *     surfaced for review even though they auto-queue)
 */
export async function GET() {
  const { db } = await getServerContext();
  const rows = await db
    .select()
    .from(agentTasks)
    .where(sql`status IN ('blocked','pending') AND payload->>'_proposal' IS NOT NULL`)
    .orderBy(desc(agentTasks.createdAt))
    .limit(200);

  return NextResponse.json(rows);
}
