import { NextResponse } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { verifyAdminRequest } from '@/lib/auth';
import { agentTasks } from '@researcher/db/schema';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = verifyAdminRequest(request);
  if (denied) return denied;
  try {
    const { id } = await params;
    const projectId = parseInt(id, 10);
    const { db } = await getServerContext();

    // Queue a task generation request for this project
    const [task] = await db
      .insert(agentTasks)
      .values({
        agentType: 'task_generator',
        status: 'pending',
        priority: 5,
        projectId,
        payload: { action: 'generate_tasks', projectId },
      })
      .returning();

    return NextResponse.json({ status: 'queued', taskId: task.id });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
