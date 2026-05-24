import { z } from 'zod';
import { existsSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AdminHandler } from './types';

const schema = z.object({
  name: z.string().min(1).refine(s => !s.includes('/') && !s.includes('..'), {
    message: 'agent name must not contain path separators',
  }),
});

export const deleteAgent: AdminHandler<typeof schema> = {
  type: 'delete_agent',
  riskLevel: 'high',
  payloadSchema: schema,
  async handle(payload, ctx) {
    const promptPath = resolve(ctx.projectDir, 'research', 'prompts', `${payload.name}.md`);
    if (!existsSync(promptPath)) {
      return { status: 'not_found', name: payload.name };
    }
    await unlink(promptPath);
    return { status: 'deleted', name: payload.name };
  },
};
