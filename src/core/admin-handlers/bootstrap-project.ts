import { z } from 'zod';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Logger } from '../logger';
import { atomicWrite } from '../upgrade';
import { buildConfigFromBootstrap, setupProjectDatabase, writeBootstrapResult } from '../../init/write-bootstrap';
import type { AdminHandler } from './types';

const log = new Logger('admin:bootstrap');

const BOOTSTRAP_MARKER = '.researcher-bootstrap-done';

const schema = z.object({
  domain: z.string().min(1),
  language: z.string().min(1),
});

/**
 * Full project bootstrap. Writes researcher.json, prompts, methods, strategy,
 * and creates the project database. High-risk because it touches a database
 * server and writes the LLM config (allowedTools etc.).
 */
export const bootstrapProjectHandler: AdminHandler<typeof schema> = {
  type: 'bootstrap_project',
  riskLevel: 'high',
  payloadSchema: schema,
  async handle(payload, ctx) {
    const markerPath = resolve(ctx.projectDir, BOOTSTRAP_MARKER);
    if (existsSync(markerPath)) {
      return { status: 'already_initialized', marker: markerPath };
    }

    const { bootstrapProject } = await import('../../init/bootstrap');

    log.info(`Bootstrapping project for domain: ${payload.domain}`);
    const result = await bootstrapProject(payload.domain, payload.language);

    const config = buildConfigFromBootstrap(result);
    const configPath = resolve(ctx.projectDir, 'researcher.json');
    await atomicWrite(configPath, JSON.stringify(config, null, 2) + '\n');

    await writeBootstrapResult(ctx.projectDir, result, {
      onProgress: msg => log.info(msg),
    });

    try {
      const packageRoot = resolve(import.meta.dir, '..', '..', '..');
      await setupProjectDatabase(config.database, resolve(packageRoot, 'drizzle'));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error(`Database setup failed: ${msg}`);
      throw new Error(`bootstrap: database setup failed (retryable): ${msg}`);
    }

    await atomicWrite(markerPath, new Date().toISOString() + '\n');

    return {
      status: 'complete',
      name: result.name,
      agents: result.agents.length,
      methods: result.methods.length,
      sources: result.recommendedSources?.length ?? 1,
    };
  },
};
