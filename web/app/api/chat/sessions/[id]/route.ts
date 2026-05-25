import { NextResponse } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { getSessionMessages } from '@researcher/subsystems/chat/conversation';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await getServerContext();
  const { id } = await params;
  const messages = await getSessionMessages(parseInt(id, 10));
  return NextResponse.json({ sessionId: parseInt(id, 10), messages });
}
