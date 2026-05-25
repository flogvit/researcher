import { createLLM, LLM } from '../../llm/llm';
import { Logger } from '../../core/logger';
import type { ProjectConfig } from '../../config';
import type { BusEvent } from './event-bus';

/**
 * Trigger evaluator (Fase 3 #92).
 *
 * Decides whether an event is worth sending as an outbound notification.
 * Default policy is conservative — silent unless the event is clearly
 * actionable. An LLM does the final call for high-signal events
 * (finding.strong, discovery.created, draft.proposal.ready).
 */

const log = new Logger('trigger-evaluator');

export interface TriggerDecision {
  notify: boolean;
  urgency: 'low' | 'medium' | 'high';
  headline: string;
  body: string;
  reason?: string;
}

const PROMPT_SYSTEM = `Decide whether this researcher should be interrupted right now.

Reply ONLY with JSON:
{"notify": boolean,
 "urgency": "low"|"medium"|"high",
 "headline": "<one sentence, ≤80 chars>",
 "body": "<two-line summary, ≤300 chars>",
 "reason": "<one sentence why notify or not>"}`;

/**
 * Cheap deterministic short-circuits before paying for an LLM call.
 */
function fastEvaluate(event: BusEvent): TriggerDecision | null {
  switch (event.type) {
    case 'subsystem.failed':
      return {
        notify: true, urgency: 'high',
        headline: `Subsystem failed: ${event.details.name ?? 'unknown'}`,
        body: String(event.details.message ?? ''),
        reason: 'Subsystem crash always interrupts',
      };
    case 'rate_limit.hit':
      return { notify: false, urgency: 'low', headline: '', body: '', reason: 'transient' };
    case 'paper.rejected':
      return { notify: false, urgency: 'low', headline: '', body: '', reason: 'rejection is routine' };
  }
  return null;
}

export async function evaluate(config: ProjectConfig, event: BusEvent): Promise<TriggerDecision> {
  const fast = fastEvaluate(event);
  if (fast) return fast;

  try {
    const llm = createLLM('notifier', config.llm, config.agents);
    const result = await llm.callJSON<TriggerDecision>(
      `Event: ${event.type}\nDetails: ${LLM.wrapUntrusted(JSON.stringify(event.details, null, 2), 'event')}`,
      PROMPT_SYSTEM,
    );
    return result.data;
  } catch (e) {
    log.warn(`LLM evaluation failed for ${event.type}: ${e instanceof Error ? e.message : e}`);
    // Conservative default: notify for finding/discovery/paper, silent otherwise.
    const interruptive = event.type === 'finding.strong'
      || event.type === 'discovery.created'
      || event.type === 'paper.draft.ready'
      || event.type === 'paper.approved'
      || event.type === 'draft.proposal.ready';
    return {
      notify: interruptive,
      urgency: 'low',
      headline: event.type,
      body: '',
      reason: 'LLM unavailable, defaulted',
    };
  }
}
