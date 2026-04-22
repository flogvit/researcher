import { NextResponse } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { projects, findings, agentTasks, researchLog } from '@researcher/db/schema';
import { eq, desc } from 'drizzle-orm';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const projectId = parseInt(id, 10);
    const { db } = await getServerContext();

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const projectFindings = await db
      .select()
      .from(findings)
      .where(eq(findings.projectId, projectId))
      .orderBy(desc(findings.createdAt))
      .limit(50);

    const projectTasks = await db
      .select()
      .from(agentTasks)
      .where(eq(agentTasks.projectId, projectId))
      .orderBy(desc(agentTasks.createdAt))
      .limit(50);

    const projectLog = await db
      .select()
      .from(researchLog)
      .orderBy(desc(researchLog.createdAt))
      .limit(50);

    return NextResponse.json({
      ...project,
      findings: projectFindings,
      tasks: projectTasks,
      log: projectLog,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const projectId = parseInt(id, 10);
    const body = await request.json() as Partial<{
      title: string;
      description: string;
      status: string;
      phase: string;
      workers: number;
    }>;

    const { db } = await getServerContext();

    const updates: Record<string, unknown> = {};
    if (body.title !== undefined) updates.title = body.title;
    if (body.description !== undefined) updates.description = body.description;
    if (body.status !== undefined) updates.status = body.status;
    if (body.phase !== undefined) updates.phase = body.phase;
    if (body.workers !== undefined) updates.workers = body.workers;
    updates.updatedAt = new Date();

    const [updated] = await db
      .update(projects)
      .set(updates)
      .where(eq(projects.id, projectId))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
