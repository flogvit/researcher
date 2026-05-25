import { NextResponse } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { getDefaultUserModel, type Scope } from '@researcher/core/user-model';

export async function GET(request: Request) {
  await getServerContext();
  const url = new URL(request.url);
  const scopeParam = url.searchParams.get('scope') ?? 'global';
  const scope: Scope = scopeParam === 'global' ? 'global' : { project: scopeParam.replace(/^project:/, '') };

  const userModel = getDefaultUserModel();
  const conclusions = await userModel.conclusions(scope, { limit: 200 });

  // Group by topic for the /me page (#84).
  const byTopic: Record<string, typeof conclusions> = {};
  for (const c of conclusions) {
    (byTopic[c.topic] ??= []).push(c);
  }

  return NextResponse.json({ scope: scopeParam, conclusions, byTopic });
}
