import { z } from 'zod';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { atomicWrite } from '../upgrade';
import type { AdminHandler } from './types';

const schema = z.object({
  key: z.string().min(1),
  value: z.unknown(),
});

/**
 * Mutates researcher.json. High-risk: changing `llm.allowedTools` or
 * `library.localSources[].path` from here is the escalation path described
 * in issue #1. Fase 2's brief mode must require approval before running this.
 */
export const modifyResearcherConfig: AdminHandler<typeof schema> = {
  type: 'modify_researcher_config',
  riskLevel: 'high',
  payloadSchema: schema,
  async handle(payload, ctx) {
    const configPath = resolve(ctx.projectDir, 'researcher.json');
    if (!existsSync(configPath)) {
      return { status: 'error', reason: 'researcher.json not found' };
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

    await atomicWrite(configPath, JSON.stringify(config, null, 2) + '\n');

    return { status: 'updated', key: payload.key, oldValue, newValue: payload.value };
  },
};
