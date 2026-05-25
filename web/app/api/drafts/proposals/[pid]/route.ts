import { NextResponse } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { verifyAdminRequest } from '@/lib/auth';
import { acceptProposal, rejectProposal } from '@researcher/subsystems/drafts/store';

export async function POST(request: Request, { params }: { params: Promise<{ pid: string }> }) {
  const denied = verifyAdminRequest(request);
  if (denied) return denied;
  await getServerContext();

  const { pid } = await params;
  const body = await request.json() as { action: 'accept' | 'reject' };
  const id = parseInt(pid, 10);

  if (body.action === 'accept') {
    const result = await acceptProposal(id);
    return NextResponse.json(result, { status: result.status === 'not_found' ? 404 : 200 });
  } else {
    const ok = await rejectProposal(id);
    return NextResponse.json({ status: ok ? 'rejected' : 'not_found' }, { status: ok ? 200 : 404 });
  }
}
