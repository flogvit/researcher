import type { SourcePlugin } from './types';
import { doajSource } from './doaj';
import { openalexSource } from './openalex';
import { semanticScholarSource } from './semantic-scholar';
import { crossrefSource } from './crossref';
import { pubmedSource } from './pubmed';
import { arxivSource } from './arxiv';

/**
 * Single source of truth for HTTP source plugins (#53).
 *
 * Both the library dispatcher and the bootstrap recommender (and any web UI
 * source picker) look up plugins through this module instead of hardcoding
 * their own list. Adding a new source = `import` here and append to `all`.
 *
 * The local-source plugin is intentionally separate — it doesn't satisfy the
 * same shape and isn't selectable from researcher.json's `library.sources`.
 */
const all: SourcePlugin[] = [
  doajSource,
  openalexSource,
  semanticScholarSource,
  crossrefSource,
  pubmedSource,
  arxivSource,
];

const byType = new Map<string, SourcePlugin>(all.map(p => [p.name, p]));

export function getSourcePlugin(type: string): SourcePlugin | undefined {
  return byType.get(type);
}

/** All registered source types — used by bootstrap and UI to enumerate options. */
export function listSourcePluginTypes(): string[] {
  return all.map(p => p.name);
}

export function listSourcePlugins(): SourcePlugin[] {
  return [...all];
}

export type { SourcePlugin };
