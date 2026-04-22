import { NextResponse } from 'next/server';
import { getDb } from '@researcher/db/connection';
import { agentTasks } from '@researcher/db/schema';
import { getServerContext, getProjectDir } from '@/lib/server-context';

export async function POST(request: Request) {
  try {
    const body = await request.json() as { domain: string; language?: string };

    if (!body.domain) {
      return NextResponse.json({ error: 'domain is required' }, { status: 400 });
    }

    const { db } = await getServerContext();

    // Queue a bootstrap admin task
    await db.insert(agentTasks).values({
      agentType: 'admin:bootstrap_project',
      status: 'pending',
      priority: 10,
      payload: {
        domain: body.domain,
        language: body.language ?? 'en',
      },
    });

    return NextResponse.json({ status: 'queued', projectDir: getProjectDir() });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
