import { NextResponse } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { verifyAdminRequest } from '@/lib/auth';
import { createSession, listSessions } from '@researcher/subsystems/chat/conversation';

export async function GET(request: Request) {
  await getServerContext();
  const url = new URL(request.url);
  const scope = url.searchParams.get('scope') ?? undefined;
  const sessions = await listSessions(scope);
  return NextResponse.json(sessions);
}

export async function POST(request: Request) {
  const denied = verifyAdminRequest(request);
  if (denied) return denied;
  await getServerContext();

  const body = await request.json() as { scope?: string; title?: string };
  const scope = body.scope ?? 'global';
  const id = await createSession(scope, body.title);
  return NextResponse.json({ id, scope, title: body.title ?? null }, { status: 201 });
}
