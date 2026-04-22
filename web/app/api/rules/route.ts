import { NextResponse } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export async function GET() {
  try {
    const { projectDir } = await getServerContext();
    const researchDir = resolve(projectDir, 'research');

    const result: {
      strategy: string | null;
      prompts: Record<string, string>;
      methods: Record<string, string>;
    } = {
      strategy: null,
      prompts: {},
      methods: {},
    };

    // Read strategy file
    const strategyPath = resolve(researchDir, 'strategy.md');
    if (existsSync(strategyPath)) {
      result.strategy = await readFile(strategyPath, 'utf-8');
    }

    // Read prompt files
    const promptsDir = resolve(researchDir, 'prompts');
    if (existsSync(promptsDir)) {
      const files = await readdir(promptsDir);
      for (const file of files) {
        if (file.endsWith('.md')) {
          const name = file.replace(/\.md$/, '');
          result.prompts[name] = await readFile(resolve(promptsDir, file), 'utf-8');
        }
      }
    }

    // Read method files
    const methodsDir = resolve(researchDir, 'methods');
    if (existsSync(methodsDir)) {
      const files = await readdir(methodsDir);
      for (const file of files) {
        if (file.endsWith('.md')) {
          const name = file.replace(/\.md$/, '');
          result.methods[name] = await readFile(resolve(methodsDir, file), 'utf-8');
        }
      }
    }

    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
