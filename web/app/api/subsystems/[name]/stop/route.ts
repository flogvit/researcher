import { NextResponse } from 'next/server';
import { getServerContext } from '@/lib/server-context';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  try {
    const { name } = await params;
    const { manager } = await getServerContext();

    const stopped = await manager.stopSubsystem(name);

    if (!stopped) {
      return NextResponse.json(
        { error: `Could not stop subsystem '${name}'. It may not exist or is not running.` },
        { status: 400 },
      );
    }

    return NextResponse.json({ status: 'stopped', name });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
