import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { atomicWrite } from '../core/upgrade';
import type { BootstrapResult } from './bootstrap';
import type { ProjectConfig } from '../config';

/**
 * Persist a BootstrapResult to disk under `projectDir`. Used by both
 * the CLI `init` command and the admin task `bootstrap_project` (#61).
 *
 * Writes are atomic (atomicWrite from #20) so a crash mid-bootstrap
 * leaves the partial files cleanly recoverable.
 */
export async function writeBootstrapResult(
  projectDir: string,
  result: BootstrapResult,
  opts: { onProgress?: (msg: string) => void } = {},
): Promise<void> {
  const progress = opts.onProgress ?? (() => {});

  const promptsDir = resolve(projectDir, 'research', 'prompts');
  mkdirSync(promptsDir, { recursive: true });
  for (const agent of result.agents) {
    await atomicWrite(resolve(promptsDir, `${agent.name}.md`), agent.prompt);
    progress(`Created agent: ${agent.name}`);
  }
  for (const method of result.methods) {
    const dir = resolve(projectDir, 'research', 'methods');
    mkdirSync(dir, { recursive: true });
    await atomicWrite(resolve(dir, `${method.name}.md`), method.content);
    progress(`Created method: ${method.name}`);
  }
  mkdirSync(resolve(projectDir, 'research'), { recursive: true });
  await atomicWrite(resolve(projectDir, 'research', 'strategy.md'), result.strategy);
  progress('Created strategy');

  if (result.moduleConfigs) {
    const dir = resolve(projectDir, 'research', 'modules');
    mkdirSync(dir, { recursive: true });
    for (const [name, mc] of Object.entries(result.moduleConfigs)) {
      await atomicWrite(resolve(dir, `${name}.json`), JSON.stringify(mc, null, 2) + '\n');
      progress(`Created module config: ${name}`);
    }
  }
  if (result.prompts) {
    for (const p of result.prompts) {
      await atomicWrite(resolve(promptsDir, `${p.name}.md`), p.content);
      progress(`Created prompt: ${p.name}`);
    }
  }
}

/**
 * Build a fresh ProjectConfig from a BootstrapResult. Same shape used by
 * the CLI init command and the bootstrap_project admin handler.
 */
export function buildConfigFromBootstrap(result: BootstrapResult, recommendedSources?: string[]): ProjectConfig {
  const sources = (recommendedSources ?? result.recommendedSources ?? ['doaj']).map(type => ({
    type,
    enabled: true,
    interval: 86400,
    settings: { searchTerms: result.searchTerms },
  }));

  return {
    name: result.name,
    description: result.description,
    language: result.language,
    database: `researcher_${result.name.replace(/-/g, '_')}`,
    llm: {
      provider: 'claude',
      model: 'opus',
      allowedTools: ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch'],
    },
    embedding: { model: 'nomic-embed-text' },
    library: { sources },
    research: {
      agentTypes: result.agents.map(a => a.name),
      strategyFile: 'research/strategy.md',
      reflectEvery: 3,
    },
  };
}

/**
 * Create the project's Postgres database and run migrations.
 *
 * Honors DATABASE_URL / DATABASE_URL_ADMIN env (#9), validates the
 * database name against the SQL identifier charset before interpolating.
 */
export async function setupProjectDatabase(databaseName: string, migrationsFolder: string): Promise<void> {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(databaseName)) {
    throw new Error(`setupProjectDatabase: unsafe database name ${JSON.stringify(databaseName)}`);
  }

  const { SQL } = await import('bun');
  const { drizzle } = await import('drizzle-orm/bun-sql');
  const { migrate } = await import('drizzle-orm/bun-sql/migrator');

  const adminUrl = process.env.DATABASE_URL_ADMIN
    ?? process.env.DATABASE_URL?.replace(/\/[^/?]+(\?|$)/, '/postgres$1')
    ?? 'postgresql://postgres@localhost:5432/postgres';
  const projectUrl = process.env.DATABASE_URL?.replace(/\/[^/?]+(\?|$)/, `/${databaseName}$1`)
    ?? `postgresql://postgres@localhost:5432/${databaseName}`;

  const adminClient = new SQL(adminUrl);
  try {
    await adminClient.unsafe(`CREATE DATABASE "${databaseName}"`);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes('already exists')) throw e;
  } finally {
    adminClient.close();
  }

  const migrationClient = new SQL(projectUrl);
  await migrationClient.unsafe('CREATE EXTENSION IF NOT EXISTS vector');
  const db = drizzle({ client: migrationClient });
  await migrate(db, { migrationsFolder });
  migrationClient.close();
}
