import { NextResponse } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { documents } from '@researcher/db/schema';
import { sql, desc } from 'drizzle-orm';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q');

    if (!q) {
      return NextResponse.json({ error: 'q parameter is required' }, { status: 400 });
    }

    const { db } = await getServerContext();

    const rows = await db
      .select({
        id: documents.id,
        url: documents.url,
        title: documents.title,
        contentType: documents.contentType,
        sourcePlugin: documents.sourcePlugin,
        author: documents.author,
        publicationYear: documents.publicationYear,
        summary: documents.summary,
        status: documents.status,
        qualityScore: documents.qualityScore,
      })
      .from(documents)
      .where(sql`(${documents.title} ILIKE ${'%' + q + '%'} OR ${documents.summary} ILIKE ${'%' + q + '%'})`)
      .orderBy(desc(documents.scoutedAt))
      .limit(50);

    return NextResponse.json(rows);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
