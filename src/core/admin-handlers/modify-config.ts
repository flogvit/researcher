import { z } from 'zod';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { atomicWrite } from '../upgrade';
import { safeName, safeDottedKey, assertWithinProject } from './safe-path';
import type { AdminHandler } from './types';

const schema = z.object({
  module: safeName,
  key: safeDottedKey,
  value: z.unknown(),
});

export const modifyConfig: AdminHandler<typeof schema> = {
  type: 'modify_config',
  riskLevel: 'medium',
  payloadSchema: schema,
  async handle(payload, ctx) {
    const configPath = resolve(ctx.projectDir, 'research', 'modules', `${payload.module}.json`);
    assertWithinProject(configPath, ctx.projectDir);

    if (!existsSync(configPath)) {
      return { status: 'error', reason: `Module config not found: ${payload.module}` };
    }

    const config = JSON.parse(await readFile(configPath, 'utf-8'));
    const keys = payload.key.split('.');
    let obj: Record<string, unknown> = config;
    for (let i = 0; i < keys.length - 1; i++) {
      const next = obj[keys[i]];
      if (typeof next !== 'object' || next === null || Array.isArray(next)) {
        obj[keys[i]] = {};
      }
      obj = obj[keys[i]] as Record<string, unknown>;
    }

    const lastKey = keys[keys.length - 1];
    const oldValue = obj[lastKey];
    obj[lastKey] = payload.value;

    await atomicWrite(configPath, JSON.stringify(config, null, 2));

    return { status: 'updated', key: payload.key, oldValue, newValue: payload.value };
  },
};
