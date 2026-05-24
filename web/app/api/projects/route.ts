import { NextResponse } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { verifyAdminRequest } from '@/lib/auth';
import { projects } from '@researcher/db/schema';
import { desc } from 'drizzle-orm';

export async function GET() {
  try {
    const { db } = await getServerContext();

    const rows = await db
      .select()
      .from(projects)
      .orderBy(desc(projects.createdAt));

    return NextResponse.json(rows);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const denied = verifyAdminRequest(request);
  if (denied) return denied;
  try {
    const body = await request.json() as {
      title: string;
      description?: string;
      workers?: number;
    };

    if (!body.title) {
      return NextResponse.json({ error: 'title is required' }, { status: 400 });
    }

    const { db } = await getServerContext();

    const [project] = await db
      .insert(projects)
      .values({
        title: body.title,
        description: body.description ?? null,
        workers: body.workers ?? 2,
      })
      .returning();

    return NextResponse.json(project, { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
