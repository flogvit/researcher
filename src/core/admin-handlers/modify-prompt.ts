import { z } from 'zod';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { atomicWrite } from '../upgrade';
import { safeName, assertWithinProject } from './safe-path';
import type { AdminHandler } from './types';

const schema = z.object({
  name: safeName,
  content: z.string(),
});

/**
 * Writes arbitrary text into research/prompts/<name>.md. The path-traversal
 * guard on `name` keeps this scoped to the prompts directory — issue #1
 * relied partly on this being unrestricted.
 */
export const modifyPrompt: AdminHandler<typeof schema> = {
  type: 'modify_prompt',
  riskLevel: 'medium',
  payloadSchema: schema,
  async handle(payload, ctx) {
    const promptsDir = resolve(ctx.projectDir, 'research', 'prompts');
    mkdirSync(promptsDir, { recursive: true });
    const promptPath = resolve(promptsDir, `${payload.name}.md`);
    assertWithinProject(promptPath, ctx.projectDir);

    const existed = existsSync(promptPath);
    await atomicWrite(promptPath, payload.content);

    return { status: existed ? 'updated' : 'created', path: promptPath, length: payload.content.length };
  },
};
