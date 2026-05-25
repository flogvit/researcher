import { createLLM, LLM, extractJSON } from '../../llm/llm';
import { Logger } from '../../core/logger';
import { z } from 'zod';
import type { ProjectConfig } from '../../config';
import { createProposal, getDraft } from './store';

/**
 * Chat-triggered edit proposals (Fase 4 #103).
 *
 * When a chat turn anchored to a draft asks for an edit (e.g. "the
 * theological discussion in section 3 lacks nuance"), the chat layer
 * calls proposeEdit() which asks the LLM to return a range-replacement
 * (start/end char offsets + replacement text + rationale). The proposal
 * is queued via createProposal; the user accepts/rejects via the
 * drafts UI or chat.
 */

const log = new Logger('draft-propose');

const EditSchema = z.object({
  kind: z.enum(['replace', 'insert']),
  rangeStart: z.number().optional(),
  rangeEnd: z.number().optional(),
  sectionAnchor: z.string().optional(),
  original: z.string().optional(),
  replacement: z.string(),
  rationale: z.string(),
});

const SYSTEM = `You propose ONE edit to a markdown draft.

Reply only with JSON:
{
  "kind": "replace"|"insert",
  "rangeStart": <char offset>,  // required for replace
  "rangeEnd": <char offset>,    // required for replace
  "sectionAnchor": "<markdown heading line>", // optional, helps rebase
  "original": "<exact text being replaced>",  // required for replace, used for stale detection
  "replacement": "<the new text>",
  "rationale": "<one-sentence justification>"
}

For 'insert', omit rangeStart/rangeEnd and provide sectionAnchor pointing
at the heading the new text should follow.

If the request cannot be turned into a single concrete edit, reply with:
{"kind":"insert","replacement":"","rationale":"<why nothing changes>"}`;

export async function proposeEdit(
  config: ProjectConfig,
  draftId: number,
  userRequest: string,
  sessionId?: number,
): Promise<{ proposalId: number; rationale: string } | null> {
  const draft = await getDraft(draftId);
  if (!draft) return null;

  const llm = createLLM('draft-proposer', config.llm, config.agents);
  const prompt = `Draft body:\n${LLM.wrapUntrusted(draft.bodyMd, 'draft')}\n\nUser request: ${LLM.wrapUntrusted(userRequest, 'request')}`;

  let parsed;
  try {
    const response = await llm.callJSON<unknown>(prompt, SYSTEM);
    parsed = EditSchema.parse(response.data);
  } catch (e) {
    log.warn(`proposal extraction failed: ${e instanceof Error ? e.message : e}`);
    return null;
  }

  if (!parsed.replacement.trim()) {
    log.info(`LLM declined to edit draft ${draftId}: ${parsed.rationale}`);
    return null;
  }

  const proposal = await createProposal({
    draftId,
    kind: parsed.kind,
    rangeStart: parsed.rangeStart,
    rangeEnd: parsed.rangeEnd,
    sectionAnchor: parsed.sectionAnchor,
    original: parsed.original,
    replacement: parsed.replacement,
    rationale: parsed.rationale,
    source: sessionId ? `chat:${sessionId}` : 'chat',
  });

  return { proposalId: proposal.id, rationale: parsed.rationale };
}
