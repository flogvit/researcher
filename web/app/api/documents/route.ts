import { NextResponse } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { documents } from '@researcher/db/schema';
import { desc, sql } from 'drizzle-orm';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export async function GET(request: Request) {
  try {
    const { db } = await getServerContext();
    const url = new URL(request.url);
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(url.searchParams.get('limit') ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT));
    const offset = Math.max(0, parseInt(url.searchParams.get('offset') ?? '0', 10) || 0);

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

    // Pagination uses the documents_scouted_at_idx DESC index added in #37.
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
      .limit(limit)
      .offset(offset);

    return NextResponse.json({ stats, documents: rows, limit, offset, total });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
