import { NextResponse } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { researchLog } from '@researcher/db/schema';
import { inArray, desc } from 'drizzle-orm';

export async function GET() {
  try {
    const { db } = await getServerContext();

    // Discovery synthesis emits 'cluster_found' / 'cluster_mature' — the
    // previous eq('cluster') matched nothing, so this endpoint always
    // returned []. Fixes #72.
    const rows = await db
      .select()
      .from(researchLog)
      .where(inArray(researchLog.eventType, ['cluster_found', 'cluster_mature']))
      .orderBy(desc(researchLog.createdAt))
      .limit(100);

    return NextResponse.json(rows);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
