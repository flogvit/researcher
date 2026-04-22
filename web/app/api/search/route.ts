import { NextResponse } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { searchSimilar } from '@researcher/llm/embeddings';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q');

    if (!q) {
      return NextResponse.json({ error: 'q parameter is required' }, { status: 400 });
    }

    // Ensure DB is initialized
    await getServerContext();

    const limit = parseInt(searchParams.get('limit') ?? '10', 10);
    const results = await searchSimilar(q, Math.min(limit, 50));

    return NextResponse.json(results);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
