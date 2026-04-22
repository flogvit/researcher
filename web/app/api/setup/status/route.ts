import { NextResponse } from 'next/server';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { getProjectDir } from '@/lib/server-context';

export async function GET() {
  const projectDir = getProjectDir();
  const configPath = resolve(projectDir, 'researcher.json');
  const initialized = existsSync(configPath);

  return NextResponse.json({ initialized, projectDir });
}
