import { NextResponse } from 'next/server';
import { getServerContext } from '@/lib/server-context';

export async function GET() {
  try {
    const { config } = await getServerContext();
    return NextResponse.json(config);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
