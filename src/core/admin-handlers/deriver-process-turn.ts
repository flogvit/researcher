import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { getDb } from '../../db/connection';
import { peerConclusions } from '../../db/schema';
import { generateEmbedding } from '../../llm/embeddings';
import { createLLM, LLM, extractJSON } from '../../llm/llm';
import { Logger } from '../logger';
import type { AdminHandler } from './types';

const log = new Logger('deriver');

const schema = z.object({
  sessionId: z.number(),
  userMessage: z.string(),
  assistantMessage: z.string(),
  scope: z.string(),
});

interface DerivedConclusion {
  topic: string;
  claim: string;
  confidence: number;
}

interface DeriverResult {
  add?: DerivedConclusion[];
  supersede?: Array<{ id: number; reason: string }>;
  refine?: Array<{ id: number; newClaim: string; reason: string }>;
}

const ALLOWED_TOPICS = ['interests', 'style', 'goals', 'sources', 'methodology', 'misc'];

const SYSTEM_PROMPT = `You extract durable facts about a researcher from a single conversation turn.

Read the user's message and the assistant's response. If the user revealed
something that should persist across sessions (their interests, methodology,
goals, trusted sources, writing style), emit it. Ignore ephemeral asks.

Reply ONLY with JSON of shape:
{
  "add": [{"topic": "interests"|"style"|"goals"|"sources"|"methodology"|"misc",
           "claim": "<one sentence>",
           "confidence": 0-100}]
}

If nothing durable was revealed, return {"add": []}.`;

/**
 * Deriver: asynchronously extracts peer_conclusions from each completed turn (#79).
 *
 * Default model: Ollama (cheap, always available). Configurable to Claude per
 * agent config when extraction quality matters. Failures are logged but
 * don't retry — the next turn re-derives.
 */
export const deriverProcessTurnHandler: AdminHandler<typeof schema> = {
  type: 'deriver_process_turn',
  riskLevel: 'low',
  payloadSchema: schema,
  async handle(payload, ctx) {
    const llm = createLLM('deriver', ctx.config.llm, ctx.config.agents);

    const prompt = `User: ${LLM.wrapUntrusted(payload.userMessage, 'user-message')}\n\nAssistant: ${LLM.wrapUntrusted(payload.assistantMessage, 'assistant-message')}`;

    let response;
    try {
      response = await llm.callJSON<DeriverResult>(prompt, SYSTEM_PROMPT);
    } catch (e) {
      log.warn(`extraction failed for session ${payload.sessionId}: ${e instanceof Error ? e.message : e}`);
      return { status: 'extraction_failed', error: String(e) };
    }

    const result = response.data;
    const adds = (result.add ?? []).filter(a => ALLOWED_TOPICS.includes(a.topic));
    if (adds.length === 0) {
      return { status: 'no_conclusions' };
    }

    const db = getDb();
    let inserted = 0;
    for (const add of adds) {
      try {
        const embedding = await generateEmbedding(add.claim);
        await db.insert(peerConclusions).values({
          scope: payload.scope,
          topic: add.topic,
          claim: add.claim,
          confidence: Math.max(0, Math.min(100, Math.round(add.confidence))),
          embedding,
          sourceSessionId: payload.sessionId,
          active: true,
        });
        inserted++;
      } catch (e) {
        log.error(`insert conclusion failed: ${e instanceof Error ? e.message : e}`);
      }
    }

    return { status: 'derived', inserted, topicsTouched: [...new Set(adds.map(a => a.topic))] };
  },
};
