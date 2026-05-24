import { getDb } from '../../../db/connection';
import { documents, embeddings } from '../../../db/schema';
import { eq } from 'drizzle-orm';
import { generateEmbedding } from '../../../llm/embeddings';
import type { ModuleConfig } from '../../../core/module-config';

const EXPECTED_EMBEDDING_DIM = 768; // matches schema vector(768) / nomic-embed-text

/**
 * Process the next document waiting to be embedded.
 * Returns true if a document was processed, false if nothing to do.
 */
export async function processNext(config?: ModuleConfig): Promise<boolean> {
  const db = getDb();

  const [item] = await db
    .select({
      id: documents.id,
      title: documents.title,
      summary: documents.summary,
      tags: documents.tags,
      topics: documents.topics,
    })
    .from(documents)
    .where(eq(documents.status, 'classified'))
    .limit(1);

  if (!item) return false;

  try {
    // Build text for embedding from classification metadata
    const parts: string[] = [item.title];
    if (item.summary) parts.push(item.summary);
    if (Array.isArray(item.tags)) parts.push(item.tags.join(', '));
    if (Array.isArray(item.topics)) parts.push(item.topics.join(', '));
    const textForEmbedding = parts.join('\n');

    const vector = await generateEmbedding(textForEmbedding);

    // Dimension mismatch (#30): a model switch (e.g. nomic-embed-text →
    // mxbai-embed-large) emits a different-sized vector that the schema's
    // vector(768) column can't accept. Don't mark the doc permanently
    // failed — leave it as 'classified' so a fix-and-retry picks it up.
    if (vector.length !== EXPECTED_EMBEDDING_DIM) {
      console.error(
        `  Embedding dimension mismatch for doc ${item.id}: got ${vector.length}, expected ${EXPECTED_EMBEDDING_DIM}. ` +
        `Check embedding.model in researcher.json. Doc left in 'classified' state for retry.`
      );
      return true;
    }

    await db.insert(embeddings).values({
      sourceType: 'document',
      sourceId: item.id,
      content: textForEmbedding,
      embedding: vector,
    });

    await db.update(documents)
      .set({
        status: 'embedded',
        embeddedAt: new Date(),
      })
      .where(eq(documents.id, item.id));

    console.log(`  Embedded: ${item.title.slice(0, 60)}`);
  } catch (e) {
    console.error(`  Embedding failed for ${item.id}:`, e instanceof Error ? e.message : e);
    await db.update(documents)
      .set({ status: 'failed_embed' })
      .where(eq(documents.id, item.id));
  }

  return true;
}
