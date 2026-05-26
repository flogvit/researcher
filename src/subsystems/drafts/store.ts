import { getDb } from '../../db/connection';
import { drafts, draftRevisions, draftEditProposals } from '../../db/schema';
import { eq, desc, and } from 'drizzle-orm';
import { Logger } from '../../core/logger';
import { loadTemplate, templateDefaultResearchScope } from './templates';

/**
 * Drafts store (Fase 4 #99).
 *
 * Owns the CRUD + revision snapshotting + edit-proposal lifecycle. Each
 * body change is captured as a draft_revisions row so we can roll back or
 * present a history view. Edit proposals are accepted/rejected here; the
 * accept path applies the diff to the body, snapshots a new revision with
 * source='proposal:<id>', and marks the proposal resolved.
 */

const log = new Logger('drafts');

export interface DraftRow {
  id: number;
  projectId: number | null;
  skill: string | null;
  template: string | null;
  title: string;
  bodyMd: string;
  researchScope: unknown;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export async function createDraft(input: {
  title: string;
  projectId?: number;
  skill?: string;
  template?: string;
  bodyMd?: string;
  researchScope?: unknown;
  projectDir?: string;
}): Promise<DraftRow> {
  const db = getDb();

  // #113: if a template is referenced and no explicit researchScope is set,
  // try to derive one from the template's filter frontmatter.
  let researchScope = input.researchScope;
  if (researchScope == null && input.skill && input.template && input.projectDir) {
    try {
      const tpl = await loadTemplate(input.projectDir, input.skill, input.template);
      const derived = templateDefaultResearchScope(tpl);
      if (derived) researchScope = derived;
    } catch (e) {
      log.warn(`could not load template ${input.skill}/${input.template} for scope default: ${e instanceof Error ? e.message : e}`);
    }
  }

  const [row] = await db.insert(drafts).values({
    title: input.title,
    projectId: input.projectId ?? null,
    skill: input.skill ?? null,
    template: input.template ?? null,
    bodyMd: input.bodyMd ?? '',
    researchScope: researchScope as object | undefined,
  }).returning();

  // Initial snapshot if non-empty body
  if (row.bodyMd) {
    await db.insert(draftRevisions).values({
      draftId: row.id,
      bodyMd: row.bodyMd,
      summary: 'initial',
      source: 'manual',
    });
  }
  log.info(`created draft ${row.id}: "${row.title}"`);
  return row as DraftRow;
}

export async function getDraft(id: number): Promise<DraftRow | null> {
  const db = getDb();
  const [row] = await db.select().from(drafts).where(eq(drafts.id, id)).limit(1);
  return (row ?? null) as DraftRow | null;
}

export async function listDrafts(projectId?: number): Promise<DraftRow[]> {
  const db = getDb();
  const q = db.select().from(drafts);
  const rows = projectId !== undefined
    ? await q.where(eq(drafts.projectId, projectId)).orderBy(desc(drafts.updatedAt))
    : await q.orderBy(desc(drafts.updatedAt));
  return rows as DraftRow[];
}

export async function updateDraftBody(id: number, bodyMd: string, source = 'manual', summary?: string): Promise<DraftRow | null> {
  const db = getDb();
  const [updated] = await db.update(drafts)
    .set({ bodyMd, updatedAt: new Date() })
    .where(eq(drafts.id, id))
    .returning();
  if (!updated) return null;
  await db.insert(draftRevisions).values({
    draftId: id,
    bodyMd,
    summary: summary ?? null,
    source,
  });
  return updated as DraftRow;
}

export async function listRevisions(draftId: number): Promise<Array<{ id: number; createdAt: Date; source: string; summary: string | null }>> {
  const db = getDb();
  return await db.select({
    id: draftRevisions.id,
    createdAt: draftRevisions.createdAt,
    source: draftRevisions.source,
    summary: draftRevisions.summary,
  }).from(draftRevisions)
    .where(eq(draftRevisions.draftId, draftId))
    .orderBy(desc(draftRevisions.createdAt));
}

export async function listProposals(draftId: number, status = 'pending'): Promise<Array<typeof draftEditProposals.$inferSelect>> {
  const db = getDb();
  return await db.select().from(draftEditProposals)
    .where(and(eq(draftEditProposals.draftId, draftId), eq(draftEditProposals.status, status)))
    .orderBy(desc(draftEditProposals.createdAt));
}

export interface ProposalInput {
  draftId: number;
  kind: 'replace' | 'insert';
  rangeStart?: number;
  rangeEnd?: number;
  sectionAnchor?: string;
  original?: string;
  replacement: string;
  rationale?: string;
  source?: string;
  sourceFindingId?: number;
}

export async function createProposal(input: ProposalInput): Promise<typeof draftEditProposals.$inferSelect> {
  const db = getDb();
  const [row] = await db.insert(draftEditProposals).values({
    draftId: input.draftId,
    kind: input.kind,
    rangeStart: input.rangeStart ?? null,
    rangeEnd: input.rangeEnd ?? null,
    sectionAnchor: input.sectionAnchor ?? null,
    original: input.original ?? null,
    replacement: input.replacement,
    rationale: input.rationale ?? null,
    source: input.source ?? null,
    sourceFindingId: input.sourceFindingId ?? null,
  }).returning();
  return row;
}

export async function acceptProposal(proposalId: number): Promise<{ status: 'accepted' | 'stale' | 'not_found'; revisionId?: number }> {
  const db = getDb();
  const [p] = await db.select().from(draftEditProposals).where(eq(draftEditProposals.id, proposalId)).limit(1);
  if (!p) return { status: 'not_found' };
  if (p.status !== 'pending') return { status: 'stale' };

  const draft = await getDraft(p.draftId);
  if (!draft) return { status: 'not_found' };

  // Apply the diff. For 'insert' we append the replacement under sectionAnchor
  // when provided, else at end. For 'replace', use the char range.
  let newBody = draft.bodyMd;
  if (p.kind === 'replace' && p.rangeStart != null && p.rangeEnd != null) {
    if (p.original && draft.bodyMd.slice(p.rangeStart, p.rangeEnd) !== p.original) {
      // Range moved — mark stale (a future rebase via sectionAnchor is the
      // next step, but the spec allows simple fail-stale for v1).
      await db.update(draftEditProposals)
        .set({ status: 'stale', resolvedAt: new Date() })
        .where(eq(draftEditProposals.id, proposalId));
      return { status: 'stale' };
    }
    newBody = draft.bodyMd.slice(0, p.rangeStart) + p.replacement + draft.bodyMd.slice(p.rangeEnd);
  } else if (p.kind === 'insert') {
    if (p.sectionAnchor) {
      const idx = draft.bodyMd.indexOf(p.sectionAnchor);
      if (idx >= 0) {
        // insert after the section heading line
        const eol = draft.bodyMd.indexOf('\n', idx);
        const insertAt = eol >= 0 ? eol + 1 : draft.bodyMd.length;
        newBody = draft.bodyMd.slice(0, insertAt) + p.replacement + '\n' + draft.bodyMd.slice(insertAt);
      } else {
        newBody = draft.bodyMd + '\n\n' + p.replacement;
      }
    } else {
      newBody = draft.bodyMd + '\n\n' + p.replacement;
    }
  }

  await db.update(drafts).set({ bodyMd: newBody, updatedAt: new Date() }).where(eq(drafts.id, draft.id));
  const [rev] = await db.insert(draftRevisions).values({
    draftId: draft.id,
    bodyMd: newBody,
    summary: p.rationale ?? null,
    source: `proposal:${proposalId}`,
  }).returning({ id: draftRevisions.id });

  await db.update(draftEditProposals)
    .set({ status: 'accepted', resolvedAt: new Date() })
    .where(eq(draftEditProposals.id, proposalId));

  return { status: 'accepted', revisionId: rev.id };
}

export async function rejectProposal(proposalId: number): Promise<boolean> {
  const db = getDb();
  const result = await db.update(draftEditProposals)
    .set({ status: 'rejected', resolvedAt: new Date() })
    .where(eq(draftEditProposals.id, proposalId))
    .returning({ id: draftEditProposals.id });
  return result.length > 0;
}

export async function deleteDraft(id: number): Promise<boolean> {
  const db = getDb();
  const result = await db.delete(drafts).where(eq(drafts.id, id)).returning({ id: drafts.id });
  return result.length > 0;
}
