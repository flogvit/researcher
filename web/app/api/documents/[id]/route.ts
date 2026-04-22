import { NextResponse } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { documents } from '@researcher/db/schema';
import { eq } from 'drizzle-orm';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { db } = await getServerContext();

    const [doc] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, parseInt(id, 10)))
      .limit(1);

    if (!doc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    return NextResponse.json(doc);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
