#!/usr/bin/env bun
import { Command } from 'commander';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { migrate } from 'drizzle-orm/bun-sql/migrator';
import { eq, sql } from 'drizzle-orm';
import { loadConfig, getDatabaseUrl, type ProjectConfig } from './config.js';
import { initDatabase, getDb, getClient } from './db/connection.js';
import { documents } from './db/schema.js';
import { LLM } from './llm/llm.js';
import { LibrarySubsystem } from './subsystems/library/index.js';
import { Orchestrator } from './core/orchestrator.js';
import type { SubsystemContext } from './core/subsystem.js';

const program = new Command();

program
  .name('researcher')
  .description('Autonomous AI research system')
  .version('0.0.1');

// ─── Helper: create context from researcher.json ─────────────────────────────

async function createContext(): Promise<{ ctx: SubsystemContext; cleanup: () => Promise<void> }> {
  const config = await loadConfig(process.cwd());
  const dbUrl = getDatabaseUrl(config);
  initDatabase(dbUrl);

  const llm = new LLM({
    provider: config.llm.provider,
    model: config.llm.model,
    baseUrl: config.llm.baseUrl,
    allowedTools: config.llm.allowedTools,
  });

  const ctx: SubsystemContext = {
    config,
    db: getDb(),
    llm,
    isReady: () => true,
    emit: () => {},
    on: () => {},
  };

  const cleanup = async () => {
    getClient().close();
  };

  return { ctx, cleanup };
}

// ─── init ─────────────────────────────────────────────────────────────────────

program
  .command('init')
  .description('Initialize a new research project in the current directory')
  .action(async () => {
    const cwd = process.cwd();
    const configPath = resolve(cwd, 'researcher.json');

    if (existsSync(configPath)) {
      console.error('Error: researcher.json already exists in this directory.');
      process.exit(1);
    }

    const dirName = basename(cwd).toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const dbName = `researcher_${dirName}`;

    const config: ProjectConfig = {
      name: dirName,
      description: '',
      language: 'en',
      database: dbName,
      llm: {
        provider: 'claude',
        model: 'sonnet',
        allowedTools: ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch'],
      },
      library: {
        sources: [],
      },
    };

    // Create researcher.json
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
    console.log('Created researcher.json');

    // Create research/ directory with empty strategy.md
    const researchDir = resolve(cwd, 'research');
    if (!existsSync(researchDir)) {
      mkdirSync(researchDir, { recursive: true });
    }
    const strategyPath = resolve(researchDir, 'strategy.md');
    if (!existsSync(strategyPath)) {
      writeFileSync(strategyPath, '# Research Strategy\n\n');
    }
    console.log('Created research/strategy.md');

    // Create the PostgreSQL database
    console.log(`Creating database "${dbName}"...`);
    const adminClient = new SQL('postgresql://postgres@localhost:5432/postgres');
    try {
      await adminClient.unsafe(`CREATE DATABASE "${dbName}"`);
      console.log(`Database "${dbName}" created.`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('already exists')) {
        console.log(`Database "${dbName}" already exists, skipping.`);
      } else {
        throw e;
      }
    } finally {
      adminClient.close();
    }

    // Run migrations
    console.log('Running migrations...');
    const dbUrl = `postgresql://postgres@localhost:5432/${dbName}`;
    const migrationClient = new SQL(dbUrl);
    const db = drizzle({ client: migrationClient });
    const packageRoot = resolve(import.meta.dir, '..'); // src/ -> package root
    await migrate(db, { migrationsFolder: resolve(packageRoot, 'drizzle') });
    migrationClient.close();
    console.log('Migrations complete.');

    console.log(`\nProject "${dirName}" initialized successfully.`);
    console.log('Next steps:');
    console.log('  1. Edit researcher.json to configure sources');
    console.log('  2. Edit research/strategy.md to define your research focus');
    console.log('  3. Run "researcher library start" to begin collecting documents');
  });

// ─── library ──────────────────────────────────────────────────────────────────

const library = program
  .command('library')
  .description('Library pipeline management');

library
  .command('start')
  .description('Run library pipeline continuously')
  .action(async () => {
    const { ctx, cleanup } = await createContext();
    const lib = new LibrarySubsystem();

    const shutdown = async () => {
      console.log('\nShutting down library...');
      await lib.stop();
      await cleanup();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    console.log('Starting library pipeline...');
    await lib.start(ctx);
    await cleanup();
  });

library
  .command('update')
  .description('Run library pipeline once')
  .action(async () => {
    const { ctx, cleanup } = await createContext();
    const lib = new LibrarySubsystem();

    console.log('Running library update...');
    await lib.update(ctx);
    await cleanup();
    console.log('Library update complete.');
  });

library
  .command('status')
  .description('Show documents per pipeline stage')
  .action(async () => {
    const { ctx, cleanup } = await createContext();
    const lib = new LibrarySubsystem();

    const status = await lib.status();

    console.log(`\nLibrary Status: ${status.state}`);
    console.log('─'.repeat(40));

    const stats = status.stats;
    const total = stats.total ?? 0;

    // Pipeline stages in order
    const stages = [
      'metadata', 'downloaded', 'extracted', 'classified', 'embedded',
      'failed_download', 'failed_extract', 'failed_classify', 'failed_embed',
    ];

    for (const stage of stages) {
      if (stats[stage] !== undefined) {
        const count = stats[stage];
        console.log(`  ${stage.padEnd(20)} ${count}`);
      }
    }

    // Show any stages not in our list
    for (const [key, value] of Object.entries(stats)) {
      if (key !== 'total' && !stages.includes(key)) {
        console.log(`  ${key.padEnd(20)} ${value}`);
      }
    }

    console.log('─'.repeat(40));
    console.log(`  ${'total'.padEnd(20)} ${total}`);

    await cleanup();
  });

library
  .command('retry')
  .description('Retry failed documents')
  .action(async () => {
    const { ctx, cleanup } = await createContext();
    const db = ctx.db;

    const retryMap: Record<string, string> = {
      failed_download: 'metadata',
      failed_extract: 'downloaded',
      failed_classify: 'extracted',
      failed_embed: 'classified',
    };

    let totalReset = 0;

    for (const [failedStatus, targetStatus] of Object.entries(retryMap)) {
      const result = await db
        .update(documents)
        .set({ status: targetStatus })
        .where(eq(documents.status, failedStatus))
        .returning({ id: documents.id });

      if (result.length > 0) {
        console.log(`  ${failedStatus} → ${targetStatus}: ${result.length} documents`);
        totalReset += result.length;
      }
    }

    if (totalReset === 0) {
      console.log('No failed documents to retry.');
    } else {
      console.log(`\nReset ${totalReset} documents for retry.`);
    }

    await cleanup();
  });

// ─── start (top-level orchestrator) ───────────────────────────────────────────

program
  .command('start')
  .description('Start all subsystems')
  .action(async () => {
    const { ctx, cleanup } = await createContext();
    const orchestrator = new Orchestrator();
    orchestrator.register(new LibrarySubsystem());

    const shutdown = async () => {
      console.log('\nShutting down all subsystems...');
      await orchestrator.stopAll();
      await cleanup();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    console.log('Starting all subsystems...');
    await orchestrator.startAll(ctx);
    await cleanup();
  });

// ─── stop ─────────────────────────────────────────────────────────────────────

program
  .command('stop')
  .description('Stop all subsystems')
  .action(async () => {
    console.log('To stop a running researcher process, use:');
    console.log('  pkill -f "bun src/cli"');
  });

// ─── status ───────────────────────────────────────────────────────────────────

program
  .command('status')
  .description('Show status of all subsystems')
  .action(async () => {
    const { ctx, cleanup } = await createContext();
    const orchestrator = new Orchestrator();
    orchestrator.register(new LibrarySubsystem());

    const statuses = await orchestrator.statusAll();

    console.log('\nResearcher Status');
    console.log('═'.repeat(50));

    for (const s of statuses) {
      console.log(`\n${s.name.toUpperCase()} [${s.state}]`);
      console.log('─'.repeat(40));
      for (const [key, value] of Object.entries(s.stats)) {
        console.log(`  ${String(key).padEnd(20)} ${value}`);
      }
      if (s.error) {
        console.log(`  ERROR: ${s.error}`);
      }
    }

    await cleanup();
  });

// ─── Run ──────────────────────────────────────────────────────────────────────

program.parse();
