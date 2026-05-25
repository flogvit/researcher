import { NextResponse } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { verifyAdminRequest } from '@/lib/auth';
import { createDraft, listDrafts } from '@researcher/subsystems/drafts/store';

export async function GET(request: Request) {
  await getServerContext();
  const url = new URL(request.url);
  const projectIdParam = url.searchParams.get('projectId');
  const projectId = projectIdParam ? parseInt(projectIdParam, 10) : undefined;
  return NextResponse.json(await listDrafts(projectId));
}

export async function POST(request: Request) {
  const denied = verifyAdminRequest(request);
  if (denied) return denied;
  await getServerContext();
  const body = await request.json() as {
    title: string;
    projectId?: number;
    skill?: string;
    template?: string;
    bodyMd?: string;
    researchScope?: unknown;
  };
  if (!body.title) return NextResponse.json({ error: 'title required' }, { status: 400 });
  const draft = await createDraft(body);
  return NextResponse.json(draft, { status: 201 });
}
