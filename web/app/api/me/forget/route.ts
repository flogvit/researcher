import { NextResponse } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { verifyAdminRequest } from '@/lib/auth';
import { getDefaultUserModel } from '@researcher/core/user-model';

export async function POST(request: Request) {
  const denied = verifyAdminRequest(request);
  if (denied) return denied;
  await getServerContext();

  const body = await request.json() as { id: number; reason?: string };
  if (!body.id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  await getDefaultUserModel().forget(body.id, body.reason);
  return NextResponse.json({ status: 'forgotten', id: body.id });
}
