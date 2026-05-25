import { getDb } from '../../../db/connection';
import { documents, researchLog } from '../../../db/schema';
import { sql } from 'drizzle-orm';
import type { SourcePlugin, SourceFilters } from './types';
import { isDuplicateByTitleOrUrl } from './dedupe';
import { Logger } from '../../../core/logger';

const log = new Logger('source:semantic-scholar');
import type { ModuleConfig, DelayConfig } from '../../../core/module-config';
import { randomDelay } from '../../../core/module-config';

/**
 * Semantic Scholar source plugin.
 * Free API, 100 requests per 5 minutes without API key.
 * Optional API key via settings.apiKey for higher limits.
 * https://api.semanticscholar.org/
 */

const API_BASE = 'https://api.semanticscholar.org/graph/v1/paper/search';
const FIELDS = 'title,year,authors,abstract,url,openAccessPdf,publicationTypes,journal';
const LIMIT = 100; // max per request

async function searchTerm(
  term: string,
  apiKey: string | undefined,
  filters: SourceFilters | undefined,
  fetchDelay?: DelayConfig,
): Promise<{ added: number; total: number }> {
  const db = getDb();
  let offset = 0;
  let added = 0;
  let total = 0;

  while (true) {
    const params = new URLSearchParams({
      query: term,
      limit: String(LIMIT),
      offset: String(offset),
      fields: FIELDS,
    });

    // Semantic Scholar supports year range as "2020-2024"
    if (filters?.yearFrom || filters?.yearTo) {
      const from = filters.yearFrom ?? '';
      const to = filters.yearTo ?? '';
      params.set('year', `${from}-${to}`);
    }

    const headers: Record<string, string> = {};
    if (apiKey) headers['x-api-key'] = apiKey;

    let data: { total: number; offset: number; next?: number; data: Array<Record<string, unknown>> };

    try {
      const response = await fetch(`${API_BASE}?${params}`, { headers });
      if (response.status === 429) {
        // Rate limited — wait and retry
        log.info('  Semantic Scholar rate limited, waiting 60s...');
        await Bun.sleep(60_000);
        continue;
      }
      if (!response.ok) break;
      data = await response.json() as typeof data;
    } catch {
      break;
    }

    if (total === 0) total = data.total;
    if (!data.data || data.data.length === 0) break;

    for (const paper of data.data) {
      const title = paper.title as string;
      if (!title) continue;

      const openAccessPdf = paper.openAccessPdf as Record<string, string> | null;

      // Client-side open access filter
      if (filters?.openAccessOnly && !openAccessPdf) continue;

      // Client-side type filter (Semantic Scholar uses publicationTypes like 'JournalArticle')
      if (filters?.type) {
        const pubTypes = paper.publicationTypes as string[] | null;
        // Map common type names: 'journal-article' -> 'JournalArticle'
        const normalizedFilter = filters.type.replace(/-/g, '').toLowerCase();
        const matches = pubTypes?.some(t => t.toLowerCase().replace(/\s+/g, '') === normalizedFilter);
        if (!matches) continue;
      }

      const paperUrl = openAccessPdf?.url
        || paper.url as string | null;

      if (await isDuplicateByTitleOrUrl(title, paperUrl)) continue;

      const authors = (paper.authors as Array<{ name: string }>)?.map(a => a.name).join(', ') || null;
      const pubTypes = paper.publicationTypes as string[] | null;
      const isPeerReviewed = pubTypes?.includes('JournalArticle') ? 'yes' : 'unknown';

      await db.insert(documents).values({
        url: paperUrl,
        title,
        contentType: 'article',
        author: authors,
        publicationYear: paper.year as number | null,
        peerReviewed: isPeerReviewed,
        sourceCredibility: 'academic',
        sourcePlugin: 'semantic-scholar',
        domainMetadata: {
          paperId: paper.paperId,
          abstract: paper.abstract,
          journal: (paper.journal as Record<string, string> | null)?.name,
          publicationTypes: pubTypes,
        },
        status: 'metadata',
      });
      added++;
    }

    if (!data.next) break;
    offset = data.next;
    // Cap at 10000 results per term (API limit)
    if (offset >= 10000) break;
    await randomDelay(fetchDelay);
  }

  if (added > 0) {
    log.info(`  Semantic Scholar "${term}" — ${total} total, ${added} new`);
  }

  return { added, total };
}

export const semanticScholarSource: SourcePlugin = {
  name: 'semantic-scholar',

  async fetch(settings: Record<string, unknown>, moduleConfig?: ModuleConfig): Promise<{ added: number; total: number }> {
    const db = getDb();
    const searchTerms = settings.searchTerms as string[];
    const apiKey = settings.apiKey as string | undefined;
    const filters = settings.filters as SourceFilters | undefined;

    if (!Array.isArray(searchTerms) || searchTerms.length === 0) {
      throw new Error('Semantic Scholar source requires settings.searchTerms to be a non-empty array');
    }

    log.info(`Semantic Scholar source: ${searchTerms.length} search terms`);

    // Semantic Scholar limits to 100 req / 5 min without API key — stay strict (#44).
    const { mapWithConcurrency } = await import('../../../core/concurrency');
    const concurrency = (moduleConfig?.sourceConcurrency as number | undefined) ?? 1;
    const results = await mapWithConcurrency(searchTerms, concurrency, t => searchTerm(t, apiKey, filters, moduleConfig?.fetchDelay));
    let totalAdded = 0;
    let grandTotal = 0;
    for (const r of results) { totalAdded += r.added; grandTotal += r.total; }

    await db.insert(researchLog).values({
      eventType: 'source_download_complete',
      agentType: 'source:semantic-scholar',
      details: {
        source: 'semantic-scholar',
        searchTerms: searchTerms.length,
        totalAdded,
        grandTotal,
      },
    });

    log.info(`Semantic Scholar source done: ${totalAdded} new articles.`);

    return { added: totalAdded, total: grandTotal };
  },
};
