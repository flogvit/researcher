import { getDb } from '../../db/connection';
import { drafts, findings } from '../../db/schema';
import { eq, sql } from 'drizzle-orm';
import { generateEmbedding } from '../../llm/embeddings';
import { createProposal } from './store';
import { emitEvent } from '../notifications/event-bus';
import { Logger } from '../../core/logger';

/**
 * Auto-research-proposals (Fase 4 #104).
 *
 * When a finding lands, scan active drafts. If a draft's research_scope
 * keywords are semantically near the finding, queue an insertion proposal
 * with the finding as source. The user sees it in the editor's proposal
 * queue, accepts or rejects.
 *
 * Connection between subsystems is the event bus (#91): research/discovery
 * emit 'finding.strong' or 'finding' events; we listen here.
 */

const log = new Logger('draft-auto');

export async function findingToProposals(findingId: number, projectId?: number): Promise<number> {
  const db = getDb();
  const [finding] = await db.select().from(findings).where(eq(findings.id, findingId)).limit(1);
  if (!finding) return 0;

  // Pull active drafts that have a research_scope set. For v1 we match all
  // active drafts in the project (or globally if no projectId on the finding).
  const candidateDrafts = await db.select().from(drafts)
    .where(sql`status = 'draft' AND research_scope IS NOT NULL ${projectId ? sql`AND project_id = ${projectId}` : sql``}`);

  if (candidateDrafts.length === 0) return 0;

  let findingEmbedding: number[];
  try {
    findingEmbedding = await generateEmbedding(`${finding.finding}\n${finding.reasoning}`);
  } catch (e) {
    log.warn(`embedding failed for finding ${findingId}: ${e instanceof Error ? e.message : e}`);
    return 0;
  }

  let queued = 0;
  for (const draft of candidateDrafts) {
    const scope = draft.researchScope as { keywords?: string[]; threshold?: number } | null;
    const keywords = scope?.keywords ?? [];
    if (keywords.length === 0) continue;

    // Semantic match: take the keywords as a single query and use it as
    // a coarse filter — if any keyword embedding similarity to the
    // finding's embedding clears the threshold, queue a proposal.
    let bestSim = 0;
    try {
      const kwVector = await generateEmbedding(keywords.join(' '));
      bestSim = cosineSimilarity(kwVector, findingEmbedding);
    } catch {
      continue;
    }

    const threshold = scope?.threshold ?? 0.55;
    if (bestSim < threshold) continue;

    // Build the proposal text — the finding rendered as a citation-ready
    // paragraph to insert near the end of the draft body.
    const insertion = formatFindingAsInsertion(finding);
    const proposal = await createProposal({
      draftId: draft.id,
      kind: 'insert',
      replacement: insertion,
      rationale: `Auto-research: finding aligned with draft scope (sim=${bestSim.toFixed(2)})`,
      source: 'auto-research',
      sourceFindingId: findingId,
    });
    queued++;
    emitEvent('draft.proposal.ready', {
      draftId: draft.id,
      proposalId: proposal.id,
      similarity: bestSim,
    });
  }

  if (queued > 0) log.info(`finding ${findingId} → ${queued} draft proposal(s)`);
  return queued;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB) || 1);
}

function formatFindingAsInsertion(finding: typeof findings.$inferSelect): string {
  return `\n\n> **Auto-research note:** ${finding.finding}\n>\n> *Reasoning:* ${finding.reasoning}\n`;
}
