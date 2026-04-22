import { NextResponse } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { discoveries } from '@researcher/db/schema';
import { eq } from 'drizzle-orm';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { db } = await getServerContext();

    const [discovery] = await db
      .select()
      .from(discoveries)
      .where(eq(discoveries.id, parseInt(id, 10)))
      .limit(1);

    if (!discovery) {
      return NextResponse.json({ error: 'Discovery not found' }, { status: 404 });
    }

    return NextResponse.json(discovery);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
