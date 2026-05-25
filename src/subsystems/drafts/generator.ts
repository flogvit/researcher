import { createLLM, LLM } from '../../llm/llm';
import { Logger } from '../../core/logger';
import { searchSimilar } from '../../llm/embeddings';
import type { ProjectConfig } from '../../config';
import { updateDraftBody, getDraft } from './store';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

/**
 * Draft generator (Fase 4 #102).
 *
 * Given a draft (with optional template + research_scope), produces a v1
 * body markdown by combining:
 *   - the skill template's scaffold (if any) — see #107
 *   - the top-N relevant findings/documents via semantic search
 *   - the user's peer_conclusions in scope (so it sounds like them)
 *
 * Output is markdown; assigned to draft.body_md and a 'generator' revision
 * is snapshotted by updateDraftBody().
 */

const log = new Logger('draft-gen');

const SYSTEM = `You are drafting a markdown document for a researcher.

You will be given:
  - A template scaffold (may be empty) — keep its section structure
  - Recent findings/documents the researcher has saved
  - Persistent facts about the researcher (their style, methodology, sources)

Produce a complete first-draft markdown document. Be honest about what's
known vs speculative. Keep the researcher's voice, not yours. Cite
specific findings inline where the structure invites it.

Output ONLY the markdown.`;

export async function generateDraft(
  config: ProjectConfig,
  projectDir: string,
  draftId: number,
  opts: { templateContent?: string; parameters?: Record<string, unknown> } = {},
): Promise<{ ok: boolean; bodyMd?: string; error?: string }> {
  const draft = await getDraft(draftId);
  if (!draft) return { ok: false, error: 'draft not found' };

  // Resolve the template either from caller or by looking up the skill+template.
  const template = opts.templateContent ?? await loadTemplate(projectDir, draft.skill, draft.template);

  // Pull top findings/documents semantically related to the draft's title +
  // research_scope keywords.
  const queryText = [
    draft.title,
    ...(Array.isArray((draft.researchScope as { keywords?: string[] })?.keywords)
      ? (draft.researchScope as { keywords: string[] }).keywords
      : []),
  ].join(' ');

  let relevant: string[] = [];
  try {
    const hits = await searchSimilar(queryText, 10);
    relevant = hits.map(h => `[${h.sourceType}#${h.sourceId}] ${h.content.slice(0, 400)}`);
  } catch (e) {
    log.warn(`semantic search failed: ${e instanceof Error ? e.message : e}`);
  }

  const prompt = [
    template ? `Template:\n${LLM.wrapUntrusted(template, 'template')}\n` : '',
    `Draft title: ${draft.title}`,
    opts.parameters ? `Parameters: ${JSON.stringify(opts.parameters)}` : '',
    relevant.length > 0 ? `\nRelevant findings/docs:\n${LLM.wrapUntrusted(relevant.join('\n\n'), 'findings')}` : '',
  ].filter(Boolean).join('\n\n');

  const llm = createLLM('draft-generator', config.llm, config.agents);
  let bodyMd: string;
  try {
    const response = await llm.call(prompt, SYSTEM);
    bodyMd = response.text.trim();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  await updateDraftBody(draftId, bodyMd, 'generator', 'v1 from generator');
  return { ok: true, bodyMd };
}

async function loadTemplate(projectDir: string, skill: string | null, templateName: string | null): Promise<string> {
  if (!skill || !templateName) return '';
  // Templates live in research/skills/<skill>/templates/<name>.md (#107).
  const path = resolve(projectDir, 'research', 'skills', skill, 'templates', `${templateName}.md`);
  if (existsSync(path)) return readFile(path, 'utf-8');
  return '';
}
