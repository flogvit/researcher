import { NextResponse } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { researchLog } from '@researcher/db/schema';
import { eq, desc } from 'drizzle-orm';

export async function GET() {
  try {
    const { db } = await getServerContext();

    const rows = await db
      .select()
      .from(researchLog)
      .where(eq(researchLog.eventType, 'cluster'))
      .orderBy(desc(researchLog.createdAt))
      .limit(100);

    return NextResponse.json(rows);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
