import { z } from 'zod';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Logger } from '../logger';
import { atomicWrite } from '../upgrade';
import type { AdminHandler } from './types';

const BOOTSTRAP_MARKER = '.researcher-bootstrap-done';

const log = new Logger('admin:bootstrap');

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
      // A previous run finished successfully. Don't re-write files or
      // re-create the DB — that would either overwrite user edits or
      // duplicate work. Re-running with --force is a deliberate operation
      // tracked separately if we need it.
      return { status: 'already_initialized', marker: markerPath };
    }

    const { bootstrapProject } = await import('../../init/bootstrap');

    log.info(`Bootstrapping project for domain: ${payload.domain}`);
    const result = await bootstrapProject(payload.domain, payload.language);

    const configPath = resolve(ctx.projectDir, 'researcher.json');

    const config = {
      name: result.name,
      description: result.description,
      language: result.language,
      database: `researcher_${result.name.replace(/-/g, '_')}`,
      llm: { provider: 'claude', model: 'opus', allowedTools: ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch'] },
      embedding: { model: 'nomic-embed-text' },
      library: {
        sources: (result.recommendedSources ?? ['doaj']).map((type: string) => ({
          type, enabled: true, interval: 86400,
          settings: { searchTerms: result.searchTerms },
        })),
      },
      research: {
        agentTypes: result.agents.map((a: { name: string }) => a.name),
        strategyFile: 'research/strategy.md',
        reflectEvery: 3,
      },
    };

    await atomicWrite(configPath, JSON.stringify(config, null, 2) + '\n');

    const promptsDir = resolve(ctx.projectDir, 'research', 'prompts');
    mkdirSync(promptsDir, { recursive: true });
    for (const agent of result.agents) {
      await atomicWrite(resolve(promptsDir, `${agent.name}.md`), agent.prompt);
    }
    for (const method of result.methods) {
      const dir = resolve(ctx.projectDir, 'research', 'methods');
      mkdirSync(dir, { recursive: true });
      await atomicWrite(resolve(dir, `${method.name}.md`), method.content);
    }
    mkdirSync(resolve(ctx.projectDir, 'research'), { recursive: true });
    await atomicWrite(resolve(ctx.projectDir, 'research', 'strategy.md'), result.strategy);

    if (result.moduleConfigs) {
      const dir = resolve(ctx.projectDir, 'research', 'modules');
      mkdirSync(dir, { recursive: true });
      for (const [name, mc] of Object.entries(result.moduleConfigs)) {
        await atomicWrite(resolve(dir, `${name}.json`), JSON.stringify(mc, null, 2) + '\n');
      }
    }
    if (result.prompts) {
      for (const p of result.prompts) {
        await atomicWrite(resolve(promptsDir, `${p.name}.md`), p.content);
      }
    }

    // DB step: throw on failure so the task ends 'failed' (retryable) rather
    // than 'completed' with status='partial' (silently stuck) — #19.
    try {
      const { SQL } = await import('bun');
      const adminClient = new SQL('postgresql://postgres@localhost:5432/postgres');
      try {
        await adminClient.unsafe(`CREATE DATABASE "${config.database}"`);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.includes('already exists')) throw e;
      }
      adminClient.close();

      const { drizzle } = await import('drizzle-orm/bun-sql');
      const { migrate } = await import('drizzle-orm/bun-sql/migrator');
      const migrationClient = new SQL(`postgresql://postgres@localhost:5432/${config.database}`);
      await migrationClient.unsafe('CREATE EXTENSION IF NOT EXISTS vector');
      const db = drizzle({ client: migrationClient });
      const packageRoot = resolve(import.meta.dir, '..', '..', '..');
      await migrate(db, { migrationsFolder: resolve(packageRoot, 'drizzle') });
      migrationClient.close();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error(`Database setup failed: ${msg}`);
      // No marker file — a future retry will re-attempt the DB step.
      // Files on disk from earlier in this handler are idempotent (atomicWrite
      // overwrites with the same content for the same config), so the retry
      // re-runs them harmlessly and gets a clean shot at the DB.
      throw new Error(`bootstrap: database setup failed (retryable): ${msg}`);
    }

    // Marker file flips this handler into the early-return branch above on
    // any future invocation, so we don't repeatedly redo a successful bootstrap.
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
