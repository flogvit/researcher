import { NextResponse } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { loadModuleConfig } from '@researcher/core/prompt-loader';

const MODULE_NAMES = ['library', 'research', 'discovery', 'paper'];

export async function GET() {
  try {
    const { projectDir } = await getServerContext();

    const modules: Record<string, unknown> = {};
    for (const name of MODULE_NAMES) {
      try {
        modules[name] = await loadModuleConfig(projectDir, name);
      } catch {
        modules[name] = null;
      }
    }

    return NextResponse.json(modules);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
