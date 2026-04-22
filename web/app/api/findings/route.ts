import { NextResponse } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { findings } from '@researcher/db/schema';
import { desc } from 'drizzle-orm';

export async function GET() {
  try {
    const { db } = await getServerContext();

    const rows = await db
      .select()
      .from(findings)
      .orderBy(desc(findings.createdAt))
      .limit(50);

    return NextResponse.json(rows);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
