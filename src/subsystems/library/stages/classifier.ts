import { getDb } from '../../../db/connection.js';
import { documents } from '../../../db/schema.js';
import { eq } from 'drizzle-orm';
import { LLM, RateLimitError } from '../../../llm/llm.js';
import { CLASSIFY_DOCUMENT } from '../../../prompts/defaults.js';

interface ClassificationResult {
  summary: string;
  tags: string[];
  topics: string[];
  relevantApproaches: string[];
  qualityScore: number;
  language: string;
  peerReviewed: string;
  sourceCredibility: string;
  author: string | null;
  publicationYear: number | null;
}

/**
 * Process the next document waiting to be classified.
 * Returns true if a document was processed, false if nothing to do.
 */
export async function processNext(llm: LLM): Promise<boolean> {
  const db = getDb();

  const [item] = await db
    .select({
      id: documents.id,
      title: documents.title,
      content: documents.content,
      contentType: documents.contentType,
    })
    .from(documents)
    .where(eq(documents.status, 'extracted'))
    .limit(1);

  if (!item || !item.content) return false;

  try {
    const prompt = LLM.formatPrompt(CLASSIFY_DOCUMENT, {
      title: item.title,
      contentType: item.contentType,
      content: item.content.slice(0, 3000),
    });

    const response = await llm.callJSON<ClassificationResult>(prompt);
    const cat = response.data;

    await db.update(documents)
      .set({
        summary: cat.summary,
        tags: cat.tags,
        topics: cat.topics,
        relevantApproaches: cat.relevantApproaches,
        qualityScore: cat.qualityScore,
        peerReviewed: cat.peerReviewed ?? 'unknown',
        sourceCredibility: cat.sourceCredibility ?? 'unknown',
        author: cat.author ?? null,
        publicationYear: cat.publicationYear ?? null,
        language: cat.language,
        status: 'classified',
        classifiedAt: new Date(),
      })
      .where(eq(documents.id, item.id));

    console.log(`  Classified: ${item.title.slice(0, 60)}`);
  } catch (e) {
    if (e instanceof RateLimitError) throw e; // Let dispatcher handle rate limits
    console.error(`  Classification failed for ${item.id}:`, e instanceof Error ? e.message : e);
    await db.update(documents)
      .set({ status: 'failed_classify' })
      .where(eq(documents.id, item.id));
  }

  return true;
}
