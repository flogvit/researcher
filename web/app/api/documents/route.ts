import { NextResponse } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { documents } from '@researcher/db/schema';
import { desc, sql } from 'drizzle-orm';

export async function GET() {
  try {
    const { db } = await getServerContext();

    // Pipeline stats
    const statusCounts = await db
      .select({
        status: documents.status,
        count: sql<number>`count(*)`,
      })
      .from(documents)
      .groupBy(documents.status);

    const stats: Record<string, number> = {};
    let total = 0;
    for (const row of statusCounts) {
      stats[row.status] = Number(row.count);
      total += Number(row.count);
    }
    stats.total = total;

    // Latest 100 documents (without heavy content fields)
    const rows = await db
      .select({
        id: documents.id,
        url: documents.url,
        title: documents.title,
        contentType: documents.contentType,
        language: documents.language,
        sourcePlugin: documents.sourcePlugin,
        tags: documents.tags,
        topics: documents.topics,
        qualityScore: documents.qualityScore,
        peerReviewed: documents.peerReviewed,
        sourceCredibility: documents.sourceCredibility,
        author: documents.author,
        publicationYear: documents.publicationYear,
        summary: documents.summary,
        status: documents.status,
        scoutedAt: documents.scoutedAt,
        downloadedAt: documents.downloadedAt,
        extractedAt: documents.extractedAt,
        classifiedAt: documents.classifiedAt,
        embeddedAt: documents.embeddedAt,
      })
      .from(documents)
      .orderBy(desc(documents.scoutedAt))
      .limit(100);

    return NextResponse.json({ stats, documents: rows });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
