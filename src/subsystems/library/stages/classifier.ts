import { getDb } from '../../../db/connection';
import { documents } from '../../../db/schema';
import { eq } from 'drizzle-orm';
import { LLM, RateLimitError } from '../../../llm/llm';
import { loadPrompt } from '../../../core/prompt-loader';
import type { ModuleConfig } from '../../../core/module-config';
import { Logger } from '../../../core/logger';

const log = new Logger('classifier');

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
export async function processNext(llm: LLM, projectDir: string = process.cwd(), config?: ModuleConfig): Promise<boolean> {
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
    const template = await loadPrompt(projectDir, 'classify');
    // Sentinel-wrap the document body so an injection inside it can't issue
    // instructions to the classifier (#8). The closing tag carries the same
    // random nonce as the opener; bruteforcing it is impractical.
    const prompt = LLM.formatPrompt(template, {
      title: item.title,
      contentType: item.contentType,
      content: LLM.wrapUntrusted(item.content.slice(0, config?.classifyContentLimit ?? 3000), 'document'),
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

    log.info(`Classified: ${item.title.slice(0, 60)}`);
  } catch (e) {
    if (e instanceof RateLimitError) throw e; // Let dispatcher handle rate limits
    log.error(`failed for doc ${item.id}: ${e instanceof Error ? e.message : e}`);
    await db.update(documents)
      .set({ status: 'failed_classify' })
      .where(eq(documents.id, item.id));
  }

  return true;
}
