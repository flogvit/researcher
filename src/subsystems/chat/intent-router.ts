import { createLLM, LLM } from '../../llm/llm';
import { Logger } from '../../core/logger';
import type { ProjectConfig } from '../../config';

/**
 * Intent router for chat (Fase 2 #87).
 *
 * Classifies each user message into one of three modes:
 *   sparring   — open discussion; respond conversationally
 *   brief      — user is asking the assistant to do something concrete
 *                (queue research, add a source, etc.). Map to an admin task.
 *   fortolker  — interpretation/analysis of existing material; pull from
 *                library + findings without taking actions
 *
 * Heuristic-fast for common patterns, falls back to LLM classification.
 */

const log = new Logger('intent');

export type ChatIntent = 'sparring' | 'brief' | 'fortolker';

export interface IntentClassification {
  intent: ChatIntent;
  confidence: number; // 0..1
  reason?: string;
}

const BRIEF_PATTERNS: RegExp[] = [
  /\b(legg til|add a|add this|kjør|run|start|queue|opprett|create)\s+/i,
  /\b(modify|update|change|deaktiver|disable|enable|aktiver)\b/i,
  /\bsla[\s']r* p[åa]\b/i,                  // "slå på X"
  /\b(slå av|skru på|skru av)\b/i,
];

const FORTOLKER_PATTERNS: RegExp[] = [
  /\b(forklar|explain|what does|hva betyr|why|hvorfor|how|hvordan)\b/i,
  /\b(summari[sz]e|oppsummer|compare|sammenlign|interpret|fortolk)\b/i,
];

const ROUTER_SYSTEM = `Classify a user message into exactly one of:
  - sparring (open chat, no action)
  - brief (asking the assistant to DO something — queue work, change config, add source)
  - fortolker (asking for interpretation/analysis of existing material)

Reply only with JSON: {"intent": "...", "confidence": 0.0-1.0, "reason": "<short>"}`;

export async function classifyIntent(config: ProjectConfig, message: string): Promise<IntentClassification> {
  // Fast path: regex heuristics with high confidence so simple cases don't pay
  // an LLM round-trip.
  if (BRIEF_PATTERNS.some(p => p.test(message))) {
    return { intent: 'brief', confidence: 0.85, reason: 'pattern match (action verb)' };
  }
  if (FORTOLKER_PATTERNS.some(p => p.test(message))) {
    return { intent: 'fortolker', confidence: 0.8, reason: 'pattern match (interpretive verb)' };
  }

  try {
    const llm = createLLM('intent-router', config.llm, config.agents);
    const result = await llm.callJSON<IntentClassification>(`Message: ${LLM.wrapUntrusted(message, 'user-message')}`, ROUTER_SYSTEM);
    if (result.data.intent && ['sparring', 'brief', 'fortolker'].includes(result.data.intent)) {
      return result.data;
    }
  } catch (e) {
    log.warn(`LLM classification failed: ${e instanceof Error ? e.message : e}`);
  }

  return { intent: 'sparring', confidence: 0.5, reason: 'default fallback' };
}
