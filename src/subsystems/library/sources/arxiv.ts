import { getDb } from '../../../db/connection';
import { documents, researchLog } from '../../../db/schema';
import { sql } from 'drizzle-orm';
import type { SourcePlugin, SourceFilters } from './types';
import { isDuplicateByTitleOrUrl } from './dedupe';
import type { ModuleConfig, DelayConfig } from '../../../core/module-config';
import { randomDelay } from '../../../core/module-config';

/**
 * arXiv source plugin via Atom API.
 * Free, no auth. Rate limited to 1 request per 3 seconds.
 * https://info.arxiv.org/help/api/
 */

const API_BASE = 'https://export.arxiv.org/api/query';
const MAX_RESULTS = 25;

interface ArxivEntry {
  title: string;
  summary: string;
  authors: string[];
  published: string;
  links: Array<{ href: string; type?: string; title?: string }>;
  categories: string[];
  id: string;
}

function parseAtomFeed(xml: string): { total: number; entries: ArxivEntry[] } {
  const totalMatch = xml.match(/<opensearch:totalResults[^>]*>(\d+)<\/opensearch:totalResults>/);
  const total = totalMatch ? parseInt(totalMatch[1]) : 0;

  const entries: ArxivEntry[] = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match;

  while ((match = entryRegex.exec(xml)) !== null) {
    const entry = match[1];

    const title = entry.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.replace(/\s+/g, ' ').trim() ?? '';
    const summary = entry.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]?.replace(/\s+/g, ' ').trim() ?? '';
    const published = entry.match(/<published>([\s\S]*?)<\/published>/)?.[1]?.trim() ?? '';
    const id = entry.match(/<id>([\s\S]*?)<\/id>/)?.[1]?.trim() ?? '';

    const authors: string[] = [];
    const authorRegex = /<author>\s*<name>([\s\S]*?)<\/name>/g;
    let authorMatch;
    while ((authorMatch = authorRegex.exec(entry)) !== null) {
      authors.push(authorMatch[1].trim());
    }

    const links: ArxivEntry['links'] = [];
    const linkRegex = /<link([^>]*?)\/?\s*>/g;
    let linkMatch;
    while ((linkMatch = linkRegex.exec(entry)) !== null) {
      const attrs = linkMatch[1];
      const href = attrs.match(/href="([^"]+)"/)?.[1] ?? '';
      const type = attrs.match(/type="([^"]+)"/)?.[1];
      const linkTitle = attrs.match(/title="([^"]+)"/)?.[1];
      if (href) links.push({ href, type, title: linkTitle });
    }

    const categories: string[] = [];
    const catRegex = /term="([^"]+)"/g;
    let catMatch;
    while ((catMatch = catRegex.exec(entry)) !== null) {
      categories.push(catMatch[1]);
    }

    entries.push({ title, summary, authors, published, links, categories, id });
  }

  return { total, entries };
}

async function searchTerm(
  term: string,
  filters: SourceFilters | undefined,
  fetchDelay?: DelayConfig,
): Promise<{ added: number; total: number }> {
  const db = getDb();
  let start = 0;
  let added = 0;
  let total = 0;

  while (true) {
    const params = new URLSearchParams({
      search_query: `all:${term}`,
      start: String(start),
      max_results: String(MAX_RESULTS),
      sortBy: 'relevance',
    });

    let xml: string;
    try {
      const response = await fetch(`${API_BASE}?${params}`);
      if (!response.ok) break;
      xml = await response.text();
    } catch {
      break;
    }

    const feed = parseAtomFeed(xml);
    if (total === 0) total = feed.total;
    if (feed.entries.length === 0) break;

    for (const entry of feed.entries) {
      if (!entry.title) continue;

      const year = entry.published ? parseInt(entry.published.slice(0, 4)) : null;

      // Client-side year filtering (arXiv API doesn't support year filters natively)
      if (filters?.yearFrom && year && year < filters.yearFrom) continue;
      if (filters?.yearTo && year && year > filters.yearTo) continue;
      // arXiv is all open access, so openAccessOnly is effectively a no-op
      // arXiv doesn't have publication types, so type filter is not applicable

      const pdfLink = entry.links.find(l => l.title === 'pdf')?.href
        ?? entry.links.find(l => l.type === 'application/pdf')?.href;
      const htmlLink = entry.links.find(l => l.type === 'text/html')?.href ?? entry.id;

      if (await isDuplicateByTitleOrUrl(entry.title, htmlLink)) continue;

      await db.insert(documents).values({
        url: htmlLink,
        title: entry.title,
        contentType: 'article',
        author: entry.authors.join(', ') || null,
        publicationYear: year && !isNaN(year) ? year : null,
        peerReviewed: 'no', // arXiv is preprint
        sourceCredibility: 'academic',
        sourcePlugin: 'arxiv',
        domainMetadata: {
          arxivId: entry.id,
          abstract: entry.summary,
          categories: entry.categories,
          pdfUrl: pdfLink,
        },
        status: 'metadata',
      });
      added++;
    }

    start += MAX_RESULTS;
    if (start >= total) break;
    await randomDelay(fetchDelay);
  }

  if (added > 0) {
    console.log(`  arXiv "${term}" — ${total} total, ${added} new`);
  }

  return { added, total };
}

export const arxivSource: SourcePlugin = {
  name: 'arxiv',

  async fetch(settings: Record<string, unknown>, moduleConfig?: ModuleConfig): Promise<{ added: number; total: number }> {
    const db = getDb();
    const searchTerms = settings.searchTerms as string[];
    const filters = settings.filters as SourceFilters | undefined;

    if (!Array.isArray(searchTerms) || searchTerms.length === 0) {
      throw new Error('arXiv source requires settings.searchTerms to be a non-empty array');
    }

    console.log(`arXiv source: ${searchTerms.length} search terms`);

    let totalAdded = 0;
    let grandTotal = 0;

    for (const term of searchTerms) {
      const result = await searchTerm(term, filters, moduleConfig?.fetchDelay);
      totalAdded += result.added;
      grandTotal += result.total;
    }

    await db.insert(researchLog).values({
      eventType: 'source_download_complete',
      agentType: 'source:arxiv',
      details: {
        source: 'arxiv',
        searchTerms: searchTerms.length,
        totalAdded,
        grandTotal,
      },
    });

    console.log(`arXiv source done: ${totalAdded} new articles.`);

    return { added: totalAdded, total: grandTotal };
  },
};
