import { getDb } from '../../../db/connection';
import { documents } from '../../../db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import type { ModuleConfig } from '../../../core/module-config';
import { randomDelay } from '../../../core/module-config';
import { claimNextDownload } from '../../../core/task-queue';

const DEFAULT_DOWNLOAD_DELAY = { minMs: 2000, maxMs: 5000 };

/**
 * Process the next document waiting to be downloaded.
 * Returns true if a document was processed, false if nothing to do.
 *
 * The claim transitions status 'metadata' → 'downloading' atomically so two
 * concurrent ticks never grab the same row (#14). A 'downloading' row that
 * crashes is reset by recoverStaleDownloads at startup (#15).
 */
export async function processNext(config?: ModuleConfig): Promise<boolean> {
  const db = getDb();
  const item = await claimNextDownload();
  if (!item) return false;

  try {
    const response = await fetch(item.url, {
      headers: {
        'User-Agent': 'ResearchBot/1.0 (academic research)',
        'Accept': 'text/html,application/xhtml+xml,application/pdf,text/plain',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      await db.update(documents)
        .set({ status: 'failed_download', rawContent: `HTTP ${response.status}` })
        .where(eq(documents.id, item.id));
      return true;
    }

    const contentType = response.headers.get('content-type') ?? 'unknown';

    if (contentType.includes('application/pdf')) {
      // Store PDF as base64 so it fits in text column
      const buffer = await response.arrayBuffer();
      const base64 = Buffer.from(buffer).toString('base64');
      await db.update(documents)
        .set({
          rawContent: base64,
          contentType: 'pdf',
          status: 'downloaded',
          downloadedAt: new Date(),
        })
        .where(eq(documents.id, item.id));
    } else {
      // HTML or text — store as-is
      const html = await response.text();
      const detectedType = contentType.includes('text/plain') ? 'text' : 'article';
      await db.update(documents)
        .set({
          rawContent: html,
          contentType: detectedType,
          status: 'downloaded',
          downloadedAt: new Date(),
        })
        .where(eq(documents.id, item.id));
    }

    console.log(`  Downloaded: ${item.title.slice(0, 60)}`);
  } catch (e) {
    await db.update(documents)
      .set({
        status: 'failed_download',
        rawContent: e instanceof Error ? e.message : String(e),
      })
      .where(eq(documents.id, item.id));
  }

  await randomDelay(config?.downloadDelay ?? DEFAULT_DOWNLOAD_DELAY);
  return true;
}

/**
 * Mark documents without URLs as failed (can't download without a URL).
 */
export async function markNoUrl(): Promise<number> {
  const db = getDb();
  const result = await db.update(documents)
    .set({ status: 'failed_download', rawContent: 'No URL available' })
    .where(and(
      eq(documents.status, 'metadata'),
      isNull(documents.url),
    ))
    .returning({ id: documents.id });
  return result.length;
}
