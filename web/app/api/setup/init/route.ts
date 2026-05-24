import { NextResponse } from 'next/server';
import { agentTasks } from '@researcher/db/schema';
import { getServerContext, getProjectDir } from '@/lib/server-context';
import { verifyAdminRequest } from '@/lib/auth';

export async function POST(request: Request) {
  const denied = verifyAdminRequest(request);
  if (denied) return denied;
  try {
    const body = await request.json() as { domain: string; language?: string };

    if (!body.domain) {
      return NextResponse.json({ error: 'domain is required' }, { status: 400 });
    }

    const { db } = await getServerContext();

    // Queue a bootstrap admin task and return its id so the UI can poll
    // /api/admin/tasks/:id for progress (issue #56).
    const [task] = await db.insert(agentTasks).values({
      agentType: 'admin:bootstrap_project',
      status: 'pending',
      priority: 10,
      payload: {
        domain: body.domain,
        language: body.language ?? 'en',
      },
    }).returning();

    return NextResponse.json({ status: 'queued', taskId: task.id, projectDir: getProjectDir() });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
