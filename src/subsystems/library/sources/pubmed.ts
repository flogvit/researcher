import { getDb } from '../../../db/connection';
import { documents, researchLog } from '../../../db/schema';
import { sql } from 'drizzle-orm';
import type { SourcePlugin, SourceFilters } from './types';
import type { ModuleConfig, DelayConfig } from '../../../core/module-config';
import { randomDelay } from '../../../core/module-config';

/**
 * PubMed source plugin via NCBI E-utilities.
 * Free, no auth required (but API key via settings.apiKey gets 10 req/s instead of 3 req/s).
 * https://www.ncbi.nlm.nih.gov/books/NBK25500/
 */

const ESEARCH_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi';
const EFETCH_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi';
const RETMAX = 20;

interface PubMedArticle {
  uid: string;
  title: string;
  authors: Array<{ name: string }>;
  sortdate: string;
  fulljournalname: string;
  elocationid?: string;
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

function buildPubMedTerm(term: string, filters?: SourceFilters): string {
  let result = term;
  if (filters?.yearFrom || filters?.yearTo) {
    const from = filters.yearFrom ?? '1900';
    const to = filters.yearTo ?? '3000';
    result += ` AND ("${from}"[Date - Publication] : "${to}"[Date - Publication])`;
  }
  if (filters?.openAccessOnly) {
    result += ' AND "open access"[filter]';
  }
  if (filters?.type) {
    // Map common types to PubMed publication type filters
    const typeMap: Record<string, string> = {
      'journal-article': 'Journal Article',
      'review': 'Review',
      'clinical-trial': 'Clinical Trial',
    };
    const pubType = typeMap[filters.type] ?? filters.type;
    result += ` AND "${pubType}"[Publication Type]`;
  }
  return result;
}

async function searchTerm(
  term: string,
  apiKey: string | undefined,
  filters: SourceFilters | undefined,
  fetchDelay?: DelayConfig,
): Promise<{ added: number; total: number }> {
  const db = getDb();
  let retstart = 0;
  let added = 0;
  let total = 0;
  const effectiveTerm = buildPubMedTerm(term, filters);

  while (true) {
    // Step 1: Search for IDs
    const searchParams = new URLSearchParams({
      db: 'pubmed',
      term: effectiveTerm,
      retmax: String(RETMAX),
      retstart: String(retstart),
      retmode: 'json',
    });
    if (apiKey) searchParams.set('api_key', apiKey);

    let searchData: { esearchresult: { count: string; idlist: string[] } };

    try {
      const response = await fetch(`${ESEARCH_BASE}?${searchParams}`);
      if (!response.ok) break;
      searchData = await response.json() as typeof searchData;
    } catch {
      break;
    }

    if (total === 0) total = parseInt(searchData.esearchresult.count);
    const ids = searchData.esearchresult.idlist;
    if (ids.length === 0) break;

    // Step 2: Fetch article summaries
    await randomDelay(fetchDelay);

    const fetchParams = new URLSearchParams({
      db: 'pubmed',
      id: ids.join(','),
      retmode: 'json',
      rettype: 'docsum',
    });
    if (apiKey) fetchParams.set('api_key', apiKey);

    let fetchData: { result: Record<string, PubMedArticle> };

    try {
      const response = await fetch(`${EFETCH_BASE}?${fetchParams}`);
      if (!response.ok) break;
      const raw = await response.json() as { result: Record<string, unknown> & { uids?: string[] } };
      fetchData = { result: raw.result as Record<string, PubMedArticle> };
    } catch {
      break;
    }

    for (const id of ids) {
      const article = fetchData.result[id];
      if (!article?.title) continue;

      const pubmedUrl = `https://pubmed.ncbi.nlm.nih.gov/${id}/`;
      if (await isDuplicate(article.title, pubmedUrl)) continue;

      const authors = article.authors?.map(a => a.name).join(', ') || null;
      const year = article.sortdate ? parseInt(article.sortdate.split('/')[0]) : null;

      await db.insert(documents).values({
        url: pubmedUrl,
        title: article.title,
        contentType: 'article',
        author: authors,
        publicationYear: year && !isNaN(year) ? year : null,
        peerReviewed: 'yes',
        sourceCredibility: 'academic',
        sourcePlugin: 'pubmed',
        domainMetadata: {
          pmid: id,
          journal: article.fulljournalname,
          doi: article.elocationid?.replace('doi: ', ''),
        },
        status: 'metadata',
      });
      added++;
    }

    retstart += RETMAX;
    if (retstart >= total) break;
    await randomDelay(fetchDelay);
  }

  if (added > 0) {
    console.log(`  PubMed "${term}" — ${total} total, ${added} new`);
  }

  return { added, total };
}

export const pubmedSource: SourcePlugin = {
  name: 'pubmed',

  async fetch(settings: Record<string, unknown>, moduleConfig?: ModuleConfig): Promise<{ added: number; total: number }> {
    const db = getDb();
    const searchTerms = settings.searchTerms as string[];
    const apiKey = settings.apiKey as string | undefined;
    const filters = settings.filters as SourceFilters | undefined;

    if (!Array.isArray(searchTerms) || searchTerms.length === 0) {
      throw new Error('PubMed source requires settings.searchTerms to be a non-empty array');
    }

    console.log(`PubMed source: ${searchTerms.length} search terms`);

    let totalAdded = 0;
    let grandTotal = 0;

    for (const term of searchTerms) {
      const result = await searchTerm(term, apiKey, filters, moduleConfig?.fetchDelay);
      totalAdded += result.added;
      grandTotal += result.total;
    }

    await db.insert(researchLog).values({
      eventType: 'source_download_complete',
      agentType: 'source:pubmed',
      details: {
        source: 'pubmed',
        searchTerms: searchTerms.length,
        totalAdded,
        grandTotal,
      },
    });

    console.log(`PubMed source done: ${totalAdded} new articles.`);

    return { added: totalAdded, total: grandTotal };
  },
};
