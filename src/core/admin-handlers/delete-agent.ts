import { z } from 'zod';
import { existsSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { safeName, assertWithinProject } from './safe-path';
import type { AdminHandler } from './types';

const schema = z.object({
  name: safeName,
});

export const deleteAgent: AdminHandler<typeof schema> = {
  type: 'delete_agent',
  riskLevel: 'high',
  payloadSchema: schema,
  async handle(payload, ctx) {
    const promptPath = resolve(ctx.projectDir, 'research', 'prompts', `${payload.name}.md`);
    assertWithinProject(promptPath, ctx.projectDir);
    if (!existsSync(promptPath)) {
      return { status: 'not_found', name: payload.name };
    }
    await unlink(promptPath);
    return { status: 'deleted', name: payload.name };
  },
};
