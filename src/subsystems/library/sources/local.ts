import { getDb } from '../../../db/connection';
import { documents } from '../../../db/schema';
import { sql, eq, and } from 'drizzle-orm';
import type { LocalSourceConfig } from '../../../config';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import { Glob } from 'bun';
import { Logger } from '../../../core/logger';

const log = new Logger('local-source');

const DEFAULT_EXTENSIONS = ['.txt', '.md', '.pdf', '.html', '.htm'];

function extractTitle(content: string, filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.md') {
    // Use first H1 heading if present
    const h1Match = content.match(/^#\s+(.+)$/m);
    if (h1Match) return h1Match[1].trim();
  }
  if (ext === '.html' || ext === '.htm') {
    const titleMatch = content.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) return titleMatch[1].trim();
  }
  return basename(filePath, ext);
}

async function isDuplicate(filePath: string): Promise<boolean> {
  const db = getDb();
  const [dup] = await db.select({ id: documents.id })
    .from(documents)
    .where(sql`${documents.url} = ${filePath} AND ${documents.sourcePlugin} = 'local'`)
    .limit(1);
  return !!dup;
}

async function isModified(filePath: string): Promise<boolean> {
  const db = getDb();
  const [doc] = await db.select({ scoutedAt: documents.scoutedAt })
    .from(documents)
    .where(sql`${documents.url} = ${filePath} AND ${documents.sourcePlugin} = 'local'`)
    .limit(1);
  if (!doc) return true; // Not indexed yet
  const fileStat = await stat(filePath);
  return fileStat.mtimeMs > doc.scoutedAt.getTime();
}

function getContentType(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.pdf': return 'pdf';
    case '.html': case '.htm': return 'article';
    case '.md': return 'text';
    case '.txt': return 'text';
    default: return 'text';
  }
}

export async function indexLocalSource(config: LocalSourceConfig): Promise<{ added: number; updated: number; total: number }> {
  const db = getDb();
  const extensions = config.extensions ?? DEFAULT_EXTENSIONS;
  const recursive = config.recursive ?? true;
  const sourceName = config.name ?? basename(config.path);

  // Build glob pattern for supported extensions
  const prefix = recursive ? '**/' : '';
  const pattern = extensions.length === 1
    ? `${prefix}*${extensions[0]}`
    : `${prefix}*.{${extensions.map(e => e.replace('.', '')).join(',')}}`;

  const glob = new Glob(pattern);
  let added = 0;
  let updated = 0;
  let total = 0;

  // Resolve the config'd root once so we can check each scanned path stays
  // inside it. Symlinks pointing outside would otherwise be followed (#35).
  const { sep } = await import('node:path');
  const sourceRoot = resolve(config.path) + sep;

  for await (const file of glob.scan({ cwd: config.path, absolute: true })) {
    total++;
    const filePath = resolve(file);
    if (!filePath.startsWith(sourceRoot) && filePath + sep !== sourceRoot) {
      console.warn(`local source: skipping ${filePath} (escapes ${config.path})`);
      continue;
    }
    const ext = extname(filePath);
    const contentType = getContentType(ext);
    const title = basename(filePath, ext);

    // Check if already indexed and not modified
    const duplicate = await isDuplicate(filePath);
    if (duplicate) {
      const modified = await isModified(filePath);
      if (!modified) continue;

      // Re-index modified file
      try {
        if (contentType === 'pdf') {
          const buffer = await readFile(filePath);
          const base64 = buffer.toString('base64');
          await db.update(documents)
            .set({
              rawContent: base64,
              contentType: 'pdf',
              status: 'downloaded',
              scoutedAt: new Date(),
            })
            .where(sql`${documents.url} = ${filePath} AND ${documents.sourcePlugin} = 'local'`);
        } else {
          const content = await readFile(filePath, 'utf-8');
          await db.update(documents)
            .set({
              content,
              contentType,
              status: 'extracted',
              scoutedAt: new Date(),
              extractedAt: new Date(),
            })
            .where(sql`${documents.url} = ${filePath} AND ${documents.sourcePlugin} = 'local'`);
        }
        updated++;
      } catch (e) {
        log.error(`Failed to re-index ${filePath}: ${e instanceof Error ? e.message : e}`);
      }
      continue;
    }

    // New file — index it
    try {
      if (contentType === 'pdf') {
        const buffer = await readFile(filePath);
        const base64 = buffer.toString('base64');
        await db.insert(documents).values({
          url: filePath,
          title,
          rawContent: base64,
          contentType: 'pdf',
          sourcePlugin: 'local',
          sourceCredibility: 'unknown',
          peerReviewed: 'unknown',
          status: 'downloaded',
          domainMetadata: { localSource: sourceName, filePath },
        });
      } else {
        const content = await readFile(filePath, 'utf-8');
        const docTitle = extractTitle(content, filePath);
        await db.insert(documents).values({
          url: filePath,
          title: docTitle,
          content,
          contentType,
          sourcePlugin: 'local',
          sourceCredibility: 'unknown',
          peerReviewed: 'unknown',
          status: 'extracted',
          extractedAt: new Date(),
          domainMetadata: { localSource: sourceName, filePath },
        });
      }
      added++;
    } catch (e) {
      log.error(`Failed to index ${filePath}: ${e instanceof Error ? e.message : e}`);
    }
  }

  // Clean up: mark documents whose files no longer exist
  const removed = await cleanupRemovedFiles(sourceName);

  if (added > 0 || updated > 0 || removed > 0) {
    log.info(`Local source "${sourceName}": ${added} new, ${updated} updated, ${removed} removed, ${total} total files`);
  }

  return { added, updated, total };
}

async function cleanupRemovedFiles(sourceName: string): Promise<number> {
  const db = getDb();

  // Find all local documents for this source
  const localDocs = await db
    .select({ id: documents.id, url: documents.url })
    .from(documents)
    .where(
      and(
        eq(documents.sourcePlugin, 'local'),
        sql`${documents.domainMetadata}->>'localSource' = ${sourceName}`,
        sql`${documents.status} NOT IN ('removed')`,
      ),
    );

  let removed = 0;
  for (const doc of localDocs) {
    if (doc.url && !existsSync(doc.url)) {
      await db.update(documents)
        .set({ status: 'removed' })
        .where(eq(documents.id, doc.id));
      removed++;
    }
  }

  return removed;
}
