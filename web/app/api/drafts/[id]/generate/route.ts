import { NextResponse } from 'next/server';
import { getServerContext, getProjectDir } from '@/lib/server-context';
import { verifyAdminRequest } from '@/lib/auth';
import { generateDraft } from '@researcher/subsystems/drafts/generator';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = verifyAdminRequest(request);
  if (denied) return denied;
  const { config } = await getServerContext();
  const { id } = await params;
  const body = await request.json().catch(() => ({})) as { templateContent?: string; parameters?: Record<string, unknown> };

  const result = await generateDraft(config, getProjectDir(), parseInt(id, 10), body);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json(result);
}
