import { getDb } from '../../../db/connection';
import { documents, researchLog } from '../../../db/schema';
import { sql } from 'drizzle-orm';
import type { SourcePlugin } from './types';
import { isDuplicateByTitleOrUrl } from './dedupe';
import { Logger } from '../../../core/logger';

const log = new Logger('source:doaj');
import type { ModuleConfig } from '../../../core/module-config';
import { randomDelay } from '../../../core/module-config';

/**
 * DOAJ source plugin.
 * Downloads ALL available articles from DOAJ matching provided search terms.
 * Paginates until there's nothing left. Deduplicates against database.
 */

const API_BASE = 'https://doaj.org/api/search/articles';
const PAGE_SIZE = 10;
const DEFAULT_DELAY = { minMs: 400, maxMs: 600 }; // Be nice to the API

interface DOAJArticle {
  bibjson: {
    title: string;
    abstract?: string;
    author?: Array<{ name: string }>;
    year?: string;
    journal?: { title: string };
    link?: Array<{ url: string; type: string }>;
    keywords?: string[];
  };
}

async function downloadTerm(term: string, moduleConfig?: ModuleConfig): Promise<{ added: number; total: number }> {
  const db = getDb();
  let page = 1;
  let added = 0;
  let total = 0;

  while (true) {
    const url = `${API_BASE}/${encodeURIComponent(term)}?page=${page}&pageSize=${PAGE_SIZE}`;
    let data: { results: DOAJArticle[]; total: number };

    try {
      const response = await fetch(url);
      if (!response.ok) break;
      data = await response.json() as typeof data;
    } catch {
      break;
    }

    if (page === 1) total = data.total;
    if (data.results.length === 0) break;

    for (const article of data.results) {
      const bib = article.bibjson;

      const articleUrl = bib.link?.find(l => l.type === 'fulltext')?.url
        ?? bib.link?.[0]?.url ?? null;

      if (await isDuplicateByTitleOrUrl(bib.title, articleUrl)) continue;

      await db.insert(documents).values({
        url: articleUrl,
        title: bib.title,
        contentType: 'article',
        author: bib.author?.map(a => a.name).join(', ') ?? null,
        publicationYear: bib.year ? parseInt(bib.year) : null,
        peerReviewed: 'yes',
        sourceCredibility: 'academic',
        sourcePlugin: 'doaj',
        domainMetadata: bib.abstract ? { abstract: bib.abstract } : null,
        status: 'metadata',
      });
      added++;
    }

    if (page * PAGE_SIZE >= data.total) break;
    page++;
    await randomDelay(moduleConfig?.fetchDelay ?? DEFAULT_DELAY);
  }

  if (added > 0) {
    log.info(`  DOAJ "${term}" — ${total} total, ${added} new`);
  }

  return { added, total };
}

export const doajSource: SourcePlugin = {
  name: 'doaj',

  async fetch(settings: Record<string, unknown>, moduleConfig?: ModuleConfig): Promise<{ added: number; total: number }> {
    const db = getDb();
    const searchTerms = settings.searchTerms as string[];

    if (!Array.isArray(searchTerms) || searchTerms.length === 0) {
      throw new Error('DOAJ source requires settings.searchTerms to be a non-empty array');
    }

    log.info(`DOAJ source: ${searchTerms.length} search terms`);

    let totalAdded = 0;
    let grandTotal = 0;

    for (const term of searchTerms) {
      const result = await downloadTerm(term, moduleConfig);
      totalAdded += result.added;
      grandTotal += result.total;
    }

    await db.insert(researchLog).values({
      eventType: 'source_download_complete',
      agentType: 'source:doaj',
      details: {
        source: 'doaj',
        searchTerms: searchTerms.length,
        totalAdded,
        grandTotal,
      },
    });

    log.info(`DOAJ source done: ${totalAdded} new articles.`);

    return { added: totalAdded, total: grandTotal };
  },
};
