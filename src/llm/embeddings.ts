import { getDb } from '../db/connection';
import { embeddings, findings } from '../db/schema';
import { sql } from 'drizzle-orm';
import type { ProjectConfig } from '../config';

let embeddingBaseUrl = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
let embeddingModel = 'nomic-embed-text';
let embeddingBatchSize = 10;

export function initEmbeddingConfig(config: ProjectConfig): void {
  embeddingBaseUrl = config.embedding?.baseUrl ?? config.llm.baseUrl ?? process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
  embeddingModel = config.embedding?.model ?? 'nomic-embed-text';
}

export function setEmbeddingBatchSize(size: number): void {
  embeddingBatchSize = size;
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await fetch(`${embeddingBaseUrl}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: embeddingModel,
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

  // Find findings that don't have embeddings yet
  const unembedded = await db
    .select({ id: findings.id, finding: findings.finding, reasoning: findings.reasoning })
    .from(findings)
    .where(
      sql`${findings.id} NOT IN (SELECT source_id FROM embeddings WHERE source_type = 'finding' AND source_id IS NOT NULL)`
    )
    .limit(embeddingBatchSize);

  let count = 0;
  for (const f of unembedded) {
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
      console.error(`Failed to embed finding ${f.id}:`, e instanceof Error ? e.message : e);
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
