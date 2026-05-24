import { z } from 'zod';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { atomicWrite } from '../upgrade';
import { safeDottedKey } from './safe-path';
import type { AdminHandler } from './types';

/**
 * Keys that an admin task is allowed to rewrite in researcher.json (#4).
 *
 * Anything that changes a privilege boundary (LLM tool surface, database
 * URL, source paths that read arbitrary disk) is intentionally out. Edits
 * that affect those keys are deployment decisions, not runtime data.
 *
 * The `[*]` wildcard matches array indices: e.g. `library.sources[*].enabled`
 * permits `library.sources.0.enabled`, `library.sources.7.enabled`, etc.
 */
const ALLOWED_KEY_PATTERNS: RegExp[] = [
  /^library\.sources\.\d+\.enabled$/,
  /^library\.sources\.\d+\.interval$/,
  /^library\.sources\.\d+\.settings\.searchTerms$/,
  /^library\.sources\.\d+\.settings\.batchSize$/,
  /^research\.reflectEvery$/,
  /^research\.agentTypes$/,
  /^description$/,
  /^language$/,
  /^orchestrator\..*$/,
  /^embedding\.model$/,
];

const schema = z.object({
  key: safeDottedKey.refine(
    k => ALLOWED_KEY_PATTERNS.some(re => re.test(k)),
    { message: 'key not in editable-by-admin allowlist' },
  ),
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
