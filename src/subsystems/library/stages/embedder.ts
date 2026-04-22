import { getDb } from '../../../db/connection';
import { documents, embeddings } from '../../../db/schema';
import { eq } from 'drizzle-orm';
import { generateEmbedding } from '../../../llm/embeddings';
import type { ModuleConfig } from '../../../core/module-config';

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
