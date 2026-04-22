import { getDb } from '../../../db/connection';
import { documents, researchLog } from '../../../db/schema';
import { sql } from 'drizzle-orm';
import type { SourcePlugin, SourceFilters } from './types';
import type { ModuleConfig, DelayConfig } from '../../../core/module-config';
import { randomDelay } from '../../../core/module-config';

/**
 * OpenAlex source plugin.
 * Free academic API, no auth required. Polite pool with mailto gets faster responses.
 * https://docs.openalex.org
 */

const API_BASE = 'https://api.openalex.org/works';
const PER_PAGE = 25;

interface OpenAlexWork {
  id: string;
  title: string;
  publication_year: number | null;
  language: string | null;
  type: string;
  open_access: { is_oa: boolean; oa_url: string | null };
  primary_location: {
    landing_page_url: string | null;
    pdf_url: string | null;
    source: { display_name: string; is_in_doaj: boolean } | null;
  } | null;
  authorships: Array<{
    author: { display_name: string };
    author_position: string;
  }>;
  abstract_inverted_index: Record<string, number[]> | null;
  keywords: Array<{ keyword: string }>;
}

function reconstructAbstract(invertedIndex: Record<string, number[]> | null): string | null {
  if (!invertedIndex) return null;
  const words: [number, string][] = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const pos of positions) {
      words.push([pos, word]);
    }
  }
  words.sort((a, b) => a[0] - b[0]);
  return words.map(w => w[1]).join(' ') || null;
}

async function isDuplicate(title: string, url: string | null): Promise<boolean> {
  const db = getDb();
  if (url) {
    const [dup] = await db.select({ id: documents.id })
      .from(documents).where(sql`${documents.url} = ${url}`).limit(1);
    if (dup) return true;
  }
  const [dup] = await db.select({ id: documents.id })
    .from(documents).where(sql`${documents.title} = ${title}`).limit(1);
  return !!dup;
}

function buildOpenAlexFilter(filters?: SourceFilters): string | null {
  if (!filters) return null;
  const parts: string[] = [];
  if (filters.yearFrom) parts.push(`publication_year:>${filters.yearFrom - 1}`);
  if (filters.yearTo) parts.push(`publication_year:<${filters.yearTo + 1}`);
  if (filters.openAccessOnly) parts.push('open_access.is_oa:true');
  if (filters.type) parts.push(`type:${filters.type}`);
  return parts.length > 0 ? parts.join(',') : null;
}

async function searchTerm(
  term: string,
  mailto: string | undefined,
  filters: SourceFilters | undefined,
  fetchDelay?: DelayConfig,
): Promise<{ added: number; total: number }> {
  const db = getDb();
  let cursor = '*';
  let added = 0;
  let total = 0;

  while (true) {
    const params = new URLSearchParams({
      search: term,
      per_page: String(PER_PAGE),
      cursor,
    });
    if (mailto) params.set('mailto', mailto);
    const filter = buildOpenAlexFilter(filters);
    if (filter) params.set('filter', filter);

    const url = `${API_BASE}?${params}`;
    let data: { meta: { count: number; next_cursor: string | null }; results: OpenAlexWork[] };

    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'ResearchBot/1.0 (academic research)' },
      });
      if (!response.ok) break;
      data = await response.json() as typeof data;
    } catch {
      break;
    }

    if (total === 0) total = data.meta.count;
    if (data.results.length === 0) break;

    for (const work of data.results) {
      if (!work.title) continue;

      const articleUrl = work.open_access.oa_url
        ?? work.primary_location?.landing_page_url
        ?? null;

      if (await isDuplicate(work.title, articleUrl)) continue;

      const authors = work.authorships.map(a => a.author.display_name).join(', ') || null;
      const abstract = reconstructAbstract(work.abstract_inverted_index);
      const isDoaj = work.primary_location?.source?.is_in_doaj ?? false;

      await db.insert(documents).values({
        url: articleUrl,
        title: work.title,
        contentType: 'article',
        author: authors,
        publicationYear: work.publication_year,
        language: work.language ?? 'en',
        peerReviewed: isDoaj ? 'yes' : 'unknown',
        sourceCredibility: 'academic',
        sourcePlugin: 'openalex',
        domainMetadata: {
          openalexId: work.id,
          abstract,
          type: work.type,
          keywords: work.keywords.map(k => k.keyword),
          journal: work.primary_location?.source?.display_name,
          isOa: work.open_access.is_oa,
          pdfUrl: work.primary_location?.pdf_url,
        },
        status: 'metadata',
      });
      added++;
    }

    if (!data.meta.next_cursor) break;
    cursor = data.meta.next_cursor;
    await randomDelay(fetchDelay);
  }

  if (added > 0) {
    console.log(`  OpenAlex "${term}" — ${total} total, ${added} new`);
  }

  return { added, total };
}

export const openalexSource: SourcePlugin = {
  name: 'openalex',

  async fetch(settings: Record<string, unknown>, moduleConfig?: ModuleConfig): Promise<{ added: number; total: number }> {
    const db = getDb();
    const searchTerms = settings.searchTerms as string[];
    const mailto = settings.mailto as string | undefined;
    const filters = settings.filters as SourceFilters | undefined;

    if (!Array.isArray(searchTerms) || searchTerms.length === 0) {
      throw new Error('OpenAlex source requires settings.searchTerms to be a non-empty array');
    }

    console.log(`OpenAlex source: ${searchTerms.length} search terms`);

    let totalAdded = 0;
    let grandTotal = 0;

    for (const term of searchTerms) {
      const result = await searchTerm(term, mailto, filters, moduleConfig?.fetchDelay);
      totalAdded += result.added;
      grandTotal += result.total;
    }

    await db.insert(researchLog).values({
      eventType: 'source_download_complete',
      agentType: 'source:openalex',
      details: {
        source: 'openalex',
        searchTerms: searchTerms.length,
        totalAdded,
        grandTotal,
      },
    });

    console.log(`OpenAlex source done: ${totalAdded} new articles.`);

    return { added: totalAdded, total: grandTotal };
  },
};
