import { NextResponse } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { listSkills, listTemplates } from '@researcher/subsystems/drafts/templates';

export async function GET() {
  const { projectDir } = await getServerContext();
  const skills = await listSkills(projectDir);
  const out = await Promise.all(skills.map(async skill => ({
    skill,
    templates: (await listTemplates(projectDir, skill)).map(t => ({
      name: t.name,
      description: t.description ?? null,
      parameters: t.parameters,
      hasFilter: !!t.filter && Object.keys(t.filter).length > 0,
    })),
  })));
  return NextResponse.json({ skills: out });
}
