import { NextResponse } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { verifyAdminRequest } from '@/lib/auth';
import { handleTurn } from '@researcher/subsystems/chat/conversation';

export async function POST(request: Request) {
  const denied = verifyAdminRequest(request);
  if (denied) return denied;

  const { config } = await getServerContext();

  const body = await request.json() as { sessionId: number; message: string };
  if (!body.sessionId || !body.message) {
    return NextResponse.json({ error: 'sessionId and message are required' }, { status: 400 });
  }

  try {
    const result = await handleTurn(config, body.sessionId, body.message);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
