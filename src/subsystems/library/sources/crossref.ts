import { getDb } from '../../../db/connection';
import { documents, researchLog } from '../../../db/schema';
import { sql } from 'drizzle-orm';
import type { SourcePlugin, SourceFilters } from './types';
import { isDuplicateByTitleOrUrl } from './dedupe';
import { Logger } from '../../../core/logger';

const log = new Logger('source:crossref');
import type { ModuleConfig, DelayConfig } from '../../../core/module-config';
import { randomDelay } from '../../../core/module-config';

/**
 * CrossRef source plugin.
 * Free API, no auth required. Polite pool with mailto gets faster responses.
 * https://api.crossref.org/
 */

const API_BASE = 'https://api.crossref.org/works';
const ROWS = 25;

interface CrossRefItem {
  DOI: string;
  title: string[];
  author?: Array<{ given?: string; family?: string }>;
  abstract?: string;
  type: string;
  'published-print'?: { 'date-parts': number[][] };
  'published-online'?: { 'date-parts': number[][] };
  'container-title'?: string[];
  link?: Array<{ URL: string; 'content-type': string }>;
}

function extractYear(item: CrossRefItem): number | null {
  const parts = item['published-print']?.['date-parts']?.[0]
    ?? item['published-online']?.['date-parts']?.[0];
  return parts?.[0] ?? null;
}

function extractUrl(item: CrossRefItem): string | null {
  // Prefer PDF links, then any link, then DOI URL
  const pdfLink = item.link?.find(l => l['content-type']?.includes('pdf'));
  if (pdfLink) return pdfLink.URL;
  if (item.link?.[0]) return item.link[0].URL;
  if (item.DOI) return `https://doi.org/${item.DOI}`;
  return null;
}

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function buildCrossRefFilter(filters?: SourceFilters): string | null {
  if (!filters) return null;
  const parts: string[] = [];
  if (filters.yearFrom) parts.push(`from-pub-date:${filters.yearFrom}`);
  if (filters.yearTo) parts.push(`until-pub-date:${filters.yearTo}`);
  if (filters.type) parts.push(`type:${filters.type}`);
  // CrossRef doesn't have a direct open-access filter via the filter param,
  // but we can filter by license presence as a proxy
  if (filters.openAccessOnly) parts.push('has-license:true');
  return parts.length > 0 ? parts.join(',') : null;
}

async function searchTerm(
  term: string,
  mailto: string | undefined,
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
      rows: String(ROWS),
      offset: String(offset),
    });
    if (mailto) params.set('mailto', mailto);
    const filter = buildCrossRefFilter(filters);
    if (filter) params.set('filter', filter);

    let data: { message: { 'total-results': number; items: CrossRefItem[] } };

    try {
      const response = await fetch(`${API_BASE}?${params}`, {
        headers: { 'User-Agent': 'ResearchBot/1.0 (academic research)' },
      });
      if (!response.ok) break;
      data = await response.json() as typeof data;
    } catch {
      break;
    }

    if (total === 0) total = data.message['total-results'];
    if (data.message.items.length === 0) break;

    for (const item of data.message.items) {
      const title = item.title?.[0];
      if (!title) continue;

      const articleUrl = extractUrl(item);
      if (await isDuplicateByTitleOrUrl(title, articleUrl)) continue;

      const authors = item.author
        ?.map(a => [a.given, a.family].filter(Boolean).join(' '))
        .join(', ') || null;
      const abstract = item.abstract ? stripHtml(item.abstract) : null;

      await db.insert(documents).values({
        url: articleUrl,
        title,
        contentType: 'article',
        author: authors,
        publicationYear: extractYear(item),
        peerReviewed: item.type === 'journal-article' ? 'yes' : 'unknown',
        sourceCredibility: 'academic',
        sourcePlugin: 'crossref',
        domainMetadata: {
          doi: item.DOI,
          abstract,
          type: item.type,
          journal: item['container-title']?.[0],
        },
        status: 'metadata',
      });
      added++;
    }

    offset += ROWS;
    if (offset >= total || offset >= 10000) break;
    await randomDelay(fetchDelay);
  }

  if (added > 0) {
    log.info(`  CrossRef "${term}" — ${total} total, ${added} new`);
  }

  return { added, total };
}

export const crossrefSource: SourcePlugin = {
  name: 'crossref',

  async fetch(settings: Record<string, unknown>, moduleConfig?: ModuleConfig): Promise<{ added: number; total: number }> {
    const db = getDb();
    const searchTerms = settings.searchTerms as string[];
    const mailto = settings.mailto as string | undefined;
    const filters = settings.filters as SourceFilters | undefined;

    if (!Array.isArray(searchTerms) || searchTerms.length === 0) {
      throw new Error('CrossRef source requires settings.searchTerms to be a non-empty array');
    }

    log.info(`CrossRef source: ${searchTerms.length} search terms`);

    const { mapWithConcurrency } = await import('../../../core/concurrency');
    const concurrency = (moduleConfig?.sourceConcurrency as number | undefined) ?? 3;
    const results = await mapWithConcurrency(searchTerms, concurrency, t => searchTerm(t, mailto, filters, moduleConfig?.fetchDelay));
    let totalAdded = 0;
    let grandTotal = 0;
    for (const r of results) { totalAdded += r.added; grandTotal += r.total; }

    await db.insert(researchLog).values({
      eventType: 'source_download_complete',
      agentType: 'source:crossref',
      details: {
        source: 'crossref',
        searchTerms: searchTerms.length,
        totalAdded,
        grandTotal,
      },
    });

    log.info(`CrossRef source done: ${totalAdded} new articles.`);

    return { added: totalAdded, total: grandTotal };
  },
};
