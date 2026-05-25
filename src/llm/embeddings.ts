import { getDb } from '../db/connection';
import { embeddings, findings } from '../db/schema';
import { sql } from 'drizzle-orm';
import type { ProjectConfig } from '../config';
import { Logger } from '../core/logger';

const log = new Logger('embeddings');

/**
 * Embeddings config is a singleton — there is one Ollama instance per
 * researcher process and the model rarely changes. Previously this was
 * three top-level `let`s mutated by initEmbeddingConfig with order-
 * sensitive defaults. Wrapping in a frozen object makes the lifecycle
 * explicit: throw if generateEmbedding is called before init (#74).
 */
interface EmbeddingState {
  baseUrl: string;
  model: string;
  batchSize: number;
}

let state: EmbeddingState | null = null;

function requireState(): EmbeddingState {
  if (!state) {
    throw new Error('Embeddings not initialized — call initEmbeddingConfig(config) first.');
  }
  return state;
}

export function initEmbeddingConfig(config: ProjectConfig): void {
  state = {
    baseUrl: config.embedding?.baseUrl ?? config.llm.baseUrl ?? process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
    model: config.embedding?.model ?? 'nomic-embed-text',
    batchSize: 10,
  };
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const { baseUrl, model } = requireState();
  const response = await fetch(`${baseUrl}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      input: text,
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama embed error: ${response.status} ${await response.text()}`);
  }

  const result = await response.json() as { embeddings: number[][] };
  return result.embeddings[0];
}

export async function embedFindings(): Promise<number> {
  const db = getDb();
  const { batchSize } = requireState();

  // LEFT JOIN ... WHERE NULL — same set as the previous NOT IN, but:
  //   - no NULL-poisoning (source_id is nullable; NOT IN with NULLs yields
  //     UNKNOWN → empty result set, same bug as #32)
  //   - uses the existing composite index on (source_type, source_id) for
  //     the join (the earlier `source_id IS NOT NULL` predicate disabled it)
  // Fixes #42.
  const unembedded = await db.execute<{ id: number; finding: string; reasoning: string }>(sql`
    SELECT f.id, f.finding, f.reasoning
    FROM findings f
    LEFT JOIN embeddings e
      ON e.source_id = f.id AND e.source_type = 'finding'
    WHERE e.id IS NULL
    LIMIT ${batchSize}
  `);
  const rows = (unembedded as unknown as { rows?: Array<{ id: number; finding: string; reasoning: string }> }).rows
    ?? (Array.isArray(unembedded) ? (unembedded as Array<{ id: number; finding: string; reasoning: string }>) : []);
  const unembeddedList = rows;

  let count = 0;
  for (const f of unembeddedList) {
    try {
      const text = `${f.finding}\n\n${f.reasoning}`;
      const vector = await generateEmbedding(text);

      await db.insert(embeddings).values({
        sourceType: 'finding',
        sourceId: f.id,
        content: text,
        embedding: vector,
      });
      count++;
    } catch (e) {
      log.error(`failed to embed finding ${f.id}: ${e instanceof Error ? e.message : e}`);
    }
  }

  return count;
}

export async function searchSimilar(query: string, limit = 5): Promise<Array<{ id: number; sourceType: string; sourceId: number | null; content: string; similarity: number }>> {
  const db = getDb();
  const queryVector = await generateEmbedding(query);

  const results = await db
    .select({
      id: embeddings.id,
      sourceType: embeddings.sourceType,
      sourceId: embeddings.sourceId,
      content: embeddings.content,
      similarity: sql<number>`1 - (${embeddings.embedding} <=> ${JSON.stringify(queryVector)}::vector)`,
    })
    .from(embeddings)
    .orderBy(sql`${embeddings.embedding} <=> ${JSON.stringify(queryVector)}::vector`)
    .limit(limit);

  return results;
}
