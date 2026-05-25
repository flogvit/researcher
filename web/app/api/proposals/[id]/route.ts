import { NextResponse } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { verifyAdminRequest } from '@/lib/auth';
import { approveProposal, rejectProposal } from '@researcher/subsystems/chat/action-executor';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = verifyAdminRequest(request);
  if (denied) return denied;
  await getServerContext();

  const { id } = await params;
  const body = await request.json() as { action: 'approve' | 'reject'; reason?: string };

  const taskId = parseInt(id, 10);
  const ok = body.action === 'approve'
    ? await approveProposal(taskId)
    : await rejectProposal(taskId, body.reason);

  if (!ok) return NextResponse.json({ error: 'proposal not found' }, { status: 404 });
  return NextResponse.json({ status: body.action === 'approve' ? 'approved' : 'rejected', taskId });
}
