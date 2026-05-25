import { z } from 'zod';
import { createLLM, LLM } from '../../llm/llm';
import { generateEmbedding } from '../../llm/embeddings';
import { getDb } from '../../db/connection';
import { peerConclusions } from '../../db/schema';
import { Logger } from '../../core/logger';
import type { ProjectConfig } from '../../config';
import { getDraft } from './store';

/**
 * Voice deriver — extract author voice/style/methodology from a completed
 * draft into peer_conclusions (Fase 4 #110).
 *
 * Triggered when a draft is marked 'published' (or via the CLI). The LLM
 * reads the body and emits {topic, claim, confidence} tuples constrained
 * to the existing topic taxonomy ('style', 'methodology', etc.). Inserts
 * into peer_conclusions same as chat-deriver (#79).
 */

const log = new Logger('draft-voice-deriver');

const Schema = z.object({
  conclusions: z.array(z.object({
    topic: z.string(),
    claim: z.string(),
    confidence: z.number().min(0).max(100),
  })),
});

const SYSTEM = `Read a researcher's completed draft. Extract durable facts about
their voice, style, methodology, and trusted-source patterns. Emit only
patterns that would help a future draft sound like them.

Reply with JSON:
{"conclusions": [
  {"topic": "style"|"methodology"|"sources"|"goals"|"misc",
   "claim": "<one sentence>",
   "confidence": 0-100}
]}

Skip facts about the draft's subject matter (those belong elsewhere).`;

const ALLOWED = new Set(['interests', 'style', 'goals', 'sources', 'methodology', 'misc']);

export async function deriveVoiceFromDraft(
  config: ProjectConfig,
  draftId: number,
  scope = 'global',
): Promise<{ inserted: number; skipped: number }> {
  const draft = await getDraft(draftId);
  if (!draft) return { inserted: 0, skipped: 0 };

  const llm = createLLM('voice-deriver', config.llm, config.agents);
  let parsed;
  try {
    const response = await llm.callJSON<unknown>(LLM.wrapUntrusted(draft.bodyMd, 'draft'), SYSTEM);
    parsed = Schema.parse(response.data);
  } catch (e) {
    log.warn(`extraction failed for draft ${draftId}: ${e instanceof Error ? e.message : e}`);
    return { inserted: 0, skipped: 0 };
  }

  const db = getDb();
  let inserted = 0;
  let skipped = 0;
  for (const c of parsed.conclusions) {
    if (!ALLOWED.has(c.topic)) { skipped++; continue; }
    try {
      const embedding = await generateEmbedding(c.claim);
      await db.insert(peerConclusions).values({
        scope,
        topic: c.topic,
        claim: c.claim,
        confidence: Math.round(c.confidence),
        embedding,
        active: true,
        evidence: { source: `draft:${draftId}` },
      });
      inserted++;
    } catch (e) {
      log.error(`insert failed: ${e instanceof Error ? e.message : e}`);
      skipped++;
    }
  }

  log.info(`draft ${draftId} → ${inserted} conclusions, ${skipped} skipped`);
  return { inserted, skipped };
}
