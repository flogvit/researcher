import { getDb } from '../../../db/connection';
import { documents } from '../../../db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import type { ModuleConfig } from '../../../core/module-config';
import { randomDelay } from '../../../core/module-config';
import { claimNextDownload } from '../../../core/task-queue';
import { safeFetch, SsrfError, ResponseTooLargeError } from '../../../core/safe-fetch';
import { Logger } from '../../../core/logger';

const log = new Logger('downloader');

const DEFAULT_DOWNLOAD_DELAY = { minMs: 2000, maxMs: 5000 };

/** 50 MB cap per document body. Anything bigger is almost certainly not what we want. */
const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;

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
    const { status, contentType, body } = await safeFetch(item.url, {
      maxBytes: MAX_DOCUMENT_BYTES,
      timeoutMs: 60_000,
      headers: {
        'User-Agent': 'ResearchBot/1.0 (academic research)',
        'Accept': 'text/html,application/xhtml+xml,application/pdf,text/plain',
      },
    });

    if (status < 200 || status >= 300) {
      await db.update(documents)
        .set({ status: 'failed_download', rawContent: `HTTP ${status}` })
        .where(eq(documents.id, item.id));
      return true;
    }

    if (contentType.includes('application/pdf')) {
      // PDFs land in raw_content as base64 — see issue #39 for why this
      // is a future schema migration target.
      const base64 = Buffer.from(body).toString('base64');
      await db.update(documents)
        .set({
          rawContent: base64,
          contentType: 'pdf',
          status: 'downloaded',
          downloadedAt: new Date(),
        })
        .where(eq(documents.id, item.id));
    } else {
      const html = new TextDecoder('utf-8', { fatal: false }).decode(body);
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

    log.info(`Downloaded: ${item.title.slice(0, 60)}`);
  } catch (e) {
    // SSRF rejection and oversize bodies land here and the document gets
    // marked failed_download with the rejection reason as raw_content.
    const reason = e instanceof SsrfError ? `SSRF blocked: ${e.message}`
      : e instanceof ResponseTooLargeError ? `Too large: ${e.message}`
      : e instanceof Error ? e.message
      : String(e);
    await db.update(documents)
      .set({ status: 'failed_download', rawContent: reason })
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
