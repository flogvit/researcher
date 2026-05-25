import { NextResponse } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { verifyAdminRequest } from '@/lib/auth';
import { getDraft, updateDraftBody, deleteDraft, listProposals, listRevisions } from '@researcher/subsystems/drafts/store';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await getServerContext();
  const { id } = await params;
  const draftId = parseInt(id, 10);
  const draft = await getDraft(draftId);
  if (!draft) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const [proposals, revisions] = await Promise.all([
    listProposals(draftId),
    listRevisions(draftId),
  ]);
  return NextResponse.json({ ...draft, proposals, revisions });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = verifyAdminRequest(request);
  if (denied) return denied;
  await getServerContext();
  const { id } = await params;
  const body = await request.json() as { bodyMd?: string };
  if (typeof body.bodyMd !== 'string') return NextResponse.json({ error: 'bodyMd required' }, { status: 400 });
  const updated = await updateDraftBody(parseInt(id, 10), body.bodyMd, 'manual');
  if (!updated) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = verifyAdminRequest(request);
  if (denied) return denied;
  await getServerContext();
  const { id } = await params;
  const ok = await deleteDraft(parseInt(id, 10));
  if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ status: 'deleted' });
}
