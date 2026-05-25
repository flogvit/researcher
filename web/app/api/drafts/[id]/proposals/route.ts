import { NextResponse } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { verifyAdminRequest } from '@/lib/auth';
import { proposeEdit } from '@researcher/subsystems/drafts/proposer';
import { listProposals } from '@researcher/subsystems/drafts/store';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await getServerContext();
  const { id } = await params;
  return NextResponse.json(await listProposals(parseInt(id, 10)));
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = verifyAdminRequest(request);
  if (denied) return denied;
  const { config } = await getServerContext();
  const { id } = await params;
  const body = await request.json() as { request: string; sessionId?: number };
  if (!body.request) return NextResponse.json({ error: 'request text required' }, { status: 400 });
  const proposal = await proposeEdit(config, parseInt(id, 10), body.request, body.sessionId);
  if (!proposal) return NextResponse.json({ error: 'could not generate proposal' }, { status: 422 });
  return NextResponse.json(proposal, { status: 201 });
}
