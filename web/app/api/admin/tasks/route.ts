import { NextResponse } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { verifyAdminRequest } from '@/lib/auth';
import { agentTasks } from '@researcher/db/schema';
import { getAdminHandler } from '@researcher/core/admin-handlers';
import { sql, desc } from 'drizzle-orm';

export async function GET() {
  try {
    const { db } = await getServerContext();

    const rows = await db
      .select()
      .from(agentTasks)
      .where(sql`${agentTasks.agentType} LIKE 'admin:%'`)
      .orderBy(desc(agentTasks.createdAt))
      .limit(100);

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
      type: string;
      payload: Record<string, unknown>;
      priority?: number;
    };

    if (!body.type || !body.payload) {
      return NextResponse.json(
        { error: 'type and payload are required' },
        { status: 400 },
      );
    }

    const handler = getAdminHandler(body.type);
    if (!handler) {
      return NextResponse.json(
        { error: `Unknown admin task type: ${body.type}` },
        { status: 400 },
      );
    }

    const parsed = handler.payloadSchema.safeParse(body.payload);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid payload', details: parsed.error.issues },
        { status: 400 },
      );
    }

    const { db } = await getServerContext();

    const [task] = await db
      .insert(agentTasks)
      .values({
        agentType: `admin:${body.type}`,
        status: 'pending',
        priority: body.priority ?? 0,
        payload: body.payload,
      })
      .returning();

    return NextResponse.json(task, { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
