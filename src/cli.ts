#!/usr/bin/env bun
import { Command } from 'commander';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { migrate } from 'drizzle-orm/bun-sql/migrator';
import { eq, sql, desc, count, and } from 'drizzle-orm';
import { loadConfig, getDatabaseUrl, type ProjectConfig } from './config';
import { bootstrapProject } from './init/bootstrap';
import { initDatabase, getDb, getClient } from './db/connection';
import { documents, agentTasks, findings, projects, researchLog } from './db/schema';
import { LLM, createLLM } from './llm/llm';
import { initEmbeddingConfig } from './llm/embeddings';
import { LibrarySubsystem } from './subsystems/library/index';
import { ResearchSubsystem } from './subsystems/research/index';
import { DiscoverySubsystem } from './subsystems/discovery/index';
import { PaperSubsystem } from './subsystems/paper/index';
import { Orchestrator } from './core/orchestrator';
import { loadState, saveState } from './core/state';
import { recoverStaleTasks, recoverStaleDownloads } from './core/task-queue';
import type { SubsystemContext } from './core/subsystem';

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
  initEmbeddingConfig(config);

  // Recover work left in transient states by a previous crash (#15).
  await recoverStaleTasks();
  await recoverStaleDownloads();

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
  .command('init [domain]')
  .description('Initialize a new research project. Provide a domain for AI-bootstrapped setup.')
  .option('-l, --language <code>', 'Language for research output (ISO code, e.g. "no", "en", "de")')
  .action(async (domain: string | undefined, opts: { language?: string }) => {
    const cwd = process.cwd();
    const configPath = resolve(cwd, 'researcher.json');
    const dirName = basename(cwd).toLowerCase().replace(/[^a-z0-9_-]/g, '_');

    let config: ProjectConfig;
    let bootstrapped = false;

    if (existsSync(configPath)) {
      // Config already exists — just set up database
      config = await loadConfig(cwd);
      console.log(`Using existing researcher.json (${config.name})`);
    } else {
      // If no domain given, ask interactively
      let finalDomain = domain;
      let finalLanguage = opts.language;

      // readline handles multi-chunk stdin and end-of-line properly. The
      // earlier `process.stdin.once('data')` only read the first chunk and
      // broke on multi-line paste (#34).
      const readlineMod = await import('node:readline/promises');
      const rl = readlineMod.createInterface({ input: process.stdin, output: process.stdout });

      if (!finalDomain) {
        finalDomain = (await rl.question('Domain: ')).trim();
      }

      if (!finalLanguage && finalDomain) {
        finalLanguage = (await rl.question('Language [en]: ')).trim() || 'en';
      }
      rl.close();

      if (finalDomain) {
        // AI-bootstrapped setup
        const result = await bootstrapProject(finalDomain, finalLanguage);
        bootstrapped = true;

        config = {
          name: result.name,
          description: result.description,
          language: result.language,
          database: `researcher_${result.name.replace(/-/g, '_')}`,
          llm: {
            provider: 'claude',
            model: 'opus',
            allowedTools: ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch'],
          },
          library: {
            sources: [{
              type: 'doaj',
              enabled: true,
              interval: 86400,
              settings: { searchTerms: result.searchTerms },
            }],
          },
          research: {
            agentTypes: result.agents.map(a => a.name),
            strategyFile: 'research/strategy.md',
            reflectEvery: 3,
          },
        };

        writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
        console.log('Created researcher.json');

        // Write all bootstrap output — agents go to prompts/ (same as all other prompts)
        const promptsDir = resolve(cwd, 'research', 'prompts');
        mkdirSync(promptsDir, { recursive: true });
        for (const agent of result.agents) {
          writeFileSync(resolve(promptsDir, `${agent.name}.md`), agent.prompt);
          console.log(`  Created agent: ${agent.name}`);
        }
        for (const method of result.methods) {
          const dir = resolve(cwd, 'research', 'methods');
          mkdirSync(dir, { recursive: true });
          writeFileSync(resolve(dir, `${method.name}.md`), method.content);
          console.log(`  Created method: ${method.name}`);
        }
        mkdirSync(resolve(cwd, 'research'), { recursive: true });
        writeFileSync(resolve(cwd, 'research', 'strategy.md'), result.strategy);
        console.log('  Created strategy');
        if (result.moduleConfigs) {
          const dir = resolve(cwd, 'research', 'modules');
          mkdirSync(dir, { recursive: true });
          for (const [name, mc] of Object.entries(result.moduleConfigs)) {
            writeFileSync(resolve(dir, `${name}.json`), JSON.stringify(mc, null, 2) + '\n');
            console.log(`  Created module config: ${name}`);
          }
        }
        if (result.prompts) {
          const dir = resolve(cwd, 'research', 'prompts');
          mkdirSync(dir, { recursive: true });
          for (const p of result.prompts) {
            writeFileSync(resolve(dir, `${p.name}.md`), p.content);
            console.log(`  Created prompt: ${p.name}`);
          }
        }
      } else {
        // No domain — blank defaults
        config = {
          name: dirName,
          description: '',
          language: 'en',
          database: `researcher_${dirName}`,
          llm: {
            provider: 'claude',
            model: 'opus',
            allowedTools: ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch'],
          },
          library: { sources: [] },
          research: { agentTypes: [], strategyFile: 'research/strategy.md', reflectEvery: 3 },
        };
        writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
        console.log('Created researcher.json');
      }
    }

    // Ensure research/ and strategy.md exist
    const researchDir = resolve(cwd, 'research');
    if (!existsSync(researchDir)) mkdirSync(researchDir, { recursive: true });
    const strategyPath = resolve(researchDir, 'strategy.md');
    if (!existsSync(strategyPath)) writeFileSync(strategyPath, '# Research Strategy\n\n');

    // Create database + run migrations
    const dbName = config.database;
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

    console.log('Running migrations...');
    const dbUrl = `postgresql://postgres@localhost:5432/${dbName}`;
    const migrationClient = new SQL(dbUrl);
    await migrationClient.unsafe('CREATE EXTENSION IF NOT EXISTS vector');
    const db = drizzle({ client: migrationClient });
    const packageRoot = resolve(import.meta.dir, '..');
    await migrate(db, { migrationsFolder: resolve(packageRoot, 'drizzle') });
    migrationClient.close();
    console.log('Migrations complete.');

    console.log(`\nProject "${config.name}" initialized successfully.`);
    if (bootstrapped) {
      console.log('Next steps:');
      console.log('  1. Review researcher.json and research/ files');
      console.log('  2. Run "researcher library start" to begin collecting documents');
    } else {
      console.log('Next steps:');
      console.log('  1. Edit researcher.json to configure sources');
      console.log('  2. Run "researcher library start" to begin collecting documents');
    }
    process.exit(0);
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

// ─── research ────────────────────────────────────────────────────────────────

const research = program
  .command('research')
  .description('Research pipeline management');

research
  .command('start')
  .description('Run research pipeline continuously')
  .action(async () => {
    const { ctx, cleanup } = await createContext();
    const res = new ResearchSubsystem();

    const shutdown = async () => {
      console.log('\nShutting down research...');
      await res.stop();
      await cleanup();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    console.log('Starting research pipeline...');
    await res.start(ctx);
    await cleanup();
  });

research
  .command('update')
  .description('Run one research cycle')
  .action(async () => {
    const { ctx, cleanup } = await createContext();
    const res = new ResearchSubsystem();

    console.log('Running research update...');
    await res.update(ctx);
    await cleanup();
    console.log('Research update complete.');
  });

research
  .command('status')
  .description('Show task queue and findings count')
  .action(async () => {
    const { ctx, cleanup } = await createContext();
    const res = new ResearchSubsystem();

    const status = await res.status();

    console.log(`\nResearch Status: ${status.state}`);
    console.log('─'.repeat(40));
    for (const [key, value] of Object.entries(status.stats)) {
      console.log(`  ${String(key).padEnd(20)} ${value}`);
    }
    if (status.error) {
      console.log(`  ERROR: ${status.error}`);
    }

    await cleanup();
  });

// ─── discovery ────────────────────────────────────────────────────────────────

const discovery = program
  .command('discovery')
  .description('Discovery pipeline management');

discovery
  .command('start')
  .description('Run discovery pipeline continuously')
  .action(async () => {
    const { ctx, cleanup } = await createContext();
    const disc = new DiscoverySubsystem();

    const shutdown = async () => {
      console.log('\nShutting down discovery...');
      await disc.stop();
      await cleanup();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    console.log('Starting discovery pipeline...');
    await disc.start(ctx);
    await cleanup();
  });

discovery
  .command('update')
  .description('Run one discovery pass')
  .action(async () => {
    const { ctx, cleanup } = await createContext();
    const disc = new DiscoverySubsystem();

    console.log('Running discovery update...');
    await disc.update(ctx);
    await cleanup();
    console.log('Discovery update complete.');
  });

discovery
  .command('status')
  .description('Show discovery counts by status')
  .action(async () => {
    const { ctx, cleanup } = await createContext();
    const disc = new DiscoverySubsystem();

    const status = await disc.status();

    console.log(`\nDiscovery Status: ${status.state}`);
    console.log('─'.repeat(40));
    for (const [key, value] of Object.entries(status.stats)) {
      console.log(`  ${String(key).padEnd(20)} ${value}`);
    }
    if (status.error) {
      console.log(`  ERROR: ${status.error}`);
    }

    await cleanup();
  });

// ─── paper ────────────────────────────────────────────────────────────────────

const paper = program
  .command('paper')
  .description('Paper pipeline management');

paper
  .command('start')
  .description('Run paper pipeline continuously')
  .action(async () => {
    const { ctx, cleanup } = await createContext();
    const pap = new PaperSubsystem();

    const shutdown = async () => {
      console.log('\nShutting down paper...');
      await pap.stop();
      await cleanup();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    console.log('Starting paper pipeline...');
    await pap.start(ctx);
    await cleanup();
  });

paper
  .command('update')
  .description('Run one paper pass')
  .action(async () => {
    const { ctx, cleanup } = await createContext();
    const pap = new PaperSubsystem();

    console.log('Running paper update...');
    await pap.update(ctx);
    await cleanup();
    console.log('Paper update complete.');
  });

paper
  .command('status')
  .description('Show paper counts by status')
  .action(async () => {
    const { ctx, cleanup } = await createContext();
    const pap = new PaperSubsystem();

    const status = await pap.status();

    console.log(`\nPaper Status: ${status.state}`);
    console.log('─'.repeat(40));
    for (const [key, value] of Object.entries(status.stats)) {
      console.log(`  ${String(key).padEnd(20)} ${value}`);
    }
    if (status.error) {
      console.log(`  ERROR: ${status.error}`);
    }

    await cleanup();
  });

// ─── focus ───────────────────────────────────────────────────────────────────

program
  .command('focus <topic>')
  .description('Set research focus')
  .action(async (topic: string) => {
    const cwd = process.cwd();
    const state = await loadState(cwd);
    state.currentFocus = topic;
    await saveState(cwd, state);
    console.log(`Research focus set to: ${topic}`);
  });

// ─── seed ────────────────────────────────────────────────────────────────────

program
  .command('seed')
  .description('Add initial research tasks')
  .action(async () => {
    const config = await loadConfig(process.cwd());
    const agentTypes = config.research?.agentTypes ?? [];

    if (agentTypes.length === 0) {
      console.error('No agent types configured in researcher.json research.agentTypes.');
      process.exit(1);
    }

    const dbUrl = getDatabaseUrl(config);
    initDatabase(dbUrl);
    const db = getDb();

    for (const agentType of agentTypes) {
      await db.insert(agentTasks).values({
        agentType,
        status: 'pending',
        priority: 0,
        payload: { description: `Initial ${agentType} research task` },
      });
      console.log(`  Seeded task for agent: ${agentType}`);
    }

    console.log(`\nSeeded ${agentTypes.length} initial tasks.`);
    getClient().close();
  });

// ─── report ──────────────────────────────────────────────────────────────────

program
  .command('report')
  .description('Show recent findings')
  .option('-n, --count <count>', 'Number of findings to show', '10')
  .action(async (opts) => {
    const config = await loadConfig(process.cwd());
    const dbUrl = getDatabaseUrl(config);
    initDatabase(dbUrl);
    const db = getDb();

    const count = parseInt(opts.count, 10);
    const rows = await db
      .select()
      .from(findings)
      .orderBy(desc(findings.createdAt))
      .limit(count);

    if (rows.length === 0) {
      console.log('No findings yet.');
    } else {
      console.log(`\nLatest ${rows.length} findings:`);
      console.log('═'.repeat(60));
      for (const row of rows) {
        console.log(`\n[${row.id}] ${row.agentType} (${row.evidenceStrength})`);
        console.log(`  ${row.finding}`);
        console.log(`  Created: ${row.createdAt}`);
      }
    }

    getClient().close();
  });

// ─── start (web UI + API + subsystem management) ────────────────────────────

program
  .command('start')
  .description('Start researcher (web UI, API, subsystem management, admin queue)')
  .option('--port <port>', 'Port to listen on', '3051')
  .option('--host <host>', 'Hostname to bind to (default 127.0.0.1; pass 0.0.0.0 to expose on LAN)', '127.0.0.1')
  .action(async (opts) => {
    const { resolve } = await import('node:path');
    const port = parseInt(opts.port);
    const webDir = resolve(import.meta.dir, '..', 'web');
    // Bind to loopback by default so the admin API isn't reachable from the
    // LAN (issue #1). Users who explicitly opt into LAN exposure via --host
    // 0.0.0.0 should set RESEARCHER_ADMIN_TOKEN so verifyAdminRequest enforces
    // bearer auth on every mutating route.
    const nextProc = Bun.spawn(
      ['bun', '--bun', 'next', 'dev', '-p', String(port), '-H', opts.host],
      {
        cwd: webDir,
        env: { ...process.env, RESEARCHER_PROJECT_DIR: process.cwd() },
        stdout: 'inherit',
        stderr: 'inherit',
      },
    );
    console.log(`\nResearcher running at http://${opts.host}:${port}\n`);
    const shutdown = () => { nextProc.kill(); process.exit(0); };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });

// ─── status ───────────────────────────────────────────────────────────────────

program
  .command('status')
  .description('Show status of all subsystems')
  .action(async () => {
    const { ctx, cleanup } = await createContext();
    const orchestrator = new Orchestrator();
    orchestrator.register(new LibrarySubsystem());
    orchestrator.register(new ResearchSubsystem());
    orchestrator.register(new DiscoverySubsystem());
    orchestrator.register(new PaperSubsystem());

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

// ─── upgrade ─────────────────────────────────────────────────────────────────

program
  .command('upgrade')
  .description('Upgrade project config, module configs, prompts, and run migrations')
  .action(async () => {
    const { upgradeProject } = await import('./core/upgrade.js');
    const result = await upgradeProject(process.cwd());

    console.log('\nUpgrade complete:');
    if (result.configUpdated.length > 0)
      console.log(`  Config: added ${result.configUpdated.join(', ')}`);
    if (result.moduleConfigsUpdated.length > 0)
      console.log(`  Modules: ${result.moduleConfigsUpdated.join('; ')}`);
    if (result.promptsAdded.length > 0)
      console.log(`  Prompts: added ${result.promptsAdded.join(', ')}`);
    if (result.filesMoved.length > 0)
      console.log(`  Moved: ${result.filesMoved.join('; ')}`);
    if (result.migrationsRun)
      console.log('  Database: migrations applied');
    if (result.warnings.length > 0) {
      console.log('  Warnings:');
      for (const w of result.warnings) console.log(`    - ${w}`);
    }
    if (result.configUpdated.length === 0 && result.moduleConfigsUpdated.length === 0 &&
        result.promptsAdded.length === 0 && result.filesMoved.length === 0) {
      console.log('  Everything up to date.');
    }
  });

// ─── queue ───────────────────────────────────────────────────────────────────

program
  .command('queue')
  .description('Show pending tasks in the queue')
  .option('-w, --watch', 'Watch mode — refresh every 2 seconds')
  .action(async (opts) => {
    const { ctx, cleanup } = await createContext();
    const db = ctx.db;

    const showQueue = async () => {
      const tasks = await db
        .select()
        .from(agentTasks)
        .where(sql`${agentTasks.status} IN ('pending', 'in_progress')`)
        .orderBy(agentTasks.createdAt)
        .limit(50);

      if (!opts.watch) {
        if (tasks.length === 0) {
          console.log('Queue is empty.');
        } else {
          console.log(`\nQueue: ${tasks.length} tasks`);
          console.log('─'.repeat(60));
          for (const t of tasks) {
            const desc = (t.payload as Record<string, unknown>)?.description ?? 'unknown';
            console.log(`  [${t.id}] ${t.agentType} (${t.status}) — ${String(desc).slice(0, 50)}`);
          }
        }
        await cleanup();
        return;
      }

      // Watch mode
      process.stdout.write('\x1B[2J\x1B[H'); // clear screen
      console.log(`Queue: ${tasks.length} tasks (watching...)`);
      console.log('─'.repeat(60));
      for (const t of tasks) {
        const desc = (t.payload as Record<string, unknown>)?.description ?? 'unknown';
        console.log(`  [${t.id}] ${t.agentType} (${t.status}) — ${String(desc).slice(0, 50)}`);
      }
    };

    if (opts.watch) {
      const shutdown = async () => { await cleanup(); process.exit(0); };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
      while (true) {
        await showQueue();
        await Bun.sleep(2000);
      }
    } else {
      await showQueue();
    }
  });

// ─── learn ───────────────────────────────────────────────────────────────────

program
  .command('learn')
  .description('Force a learning cycle from accumulated review feedback')
  .action(async () => {
    const { ctx, cleanup } = await createContext();
    const { Learner } = await import('./core/learner.js');
    const { loadModuleConfig } = await import('./core/prompt-loader.js');
    const paperConfig = await loadModuleConfig(process.cwd(), 'paper');
    const llm = createLLM('learner', ctx.config.llm, ctx.config.agents);
    const learner = new Learner(llm, process.cwd(), paperConfig);
    const result = await learner.forceLearn();
    console.log(result ? 'Learning cycle completed.' : 'No reviews to learn from.');
    await cleanup();
  });

// ─── project ──────────────────────────────────────────────────────────────────

const project = program
  .command('project')
  .description('Research project management');

project
  .command('create [title]')
  .description('Create a new research project')
  .option('-d, --description <text>', 'Project description')
  .option('-f, --file <path>', 'Create from JSON config file')
  .action(async (title: string | undefined, opts) => {
    const { ctx, cleanup } = await createContext();
    const db = ctx.db;

    let projectTitle: string;
    let projectDescription: string | undefined;

    if (opts.file) {
      const fileContent = await Bun.file(opts.file).text();
      const parsed = JSON.parse(fileContent) as { title: string; description?: string };
      projectTitle = parsed.title;
      projectDescription = parsed.description;
    } else {
      if (!title) {
        console.error('Error: title is required unless --file is provided.');
        await cleanup();
        process.exit(1);
      }
      projectTitle = title;
      projectDescription = opts.description;
    }

    const [created] = await db.insert(projects).values({
      title: projectTitle,
      description: projectDescription ?? null,
      status: 'active',
      phase: 'literature_search',
    }).returning();

    await db.insert(researchLog).values({
      eventType: 'project_created',
      details: { projectId: created.id, title: projectTitle, description: projectDescription },
    });

    console.log(`Project created: [${created.id}] ${created.title}`);
    console.log(`  Status: ${created.status}`);
    console.log(`  Phase:  ${created.phase}`);
    if (created.description) {
      console.log(`  Description: ${created.description}`);
    }

    await cleanup();
  });

project
  .command('list')
  .description('List all research projects')
  .action(async () => {
    const { ctx, cleanup } = await createContext();
    const db = ctx.db;

    const rows = await db.select().from(projects).orderBy(projects.id);

    if (rows.length === 0) {
      console.log('No projects found.');
      await cleanup();
      return;
    }

    const idW = 4;
    const statusW = 8;
    const phaseW = 18;
    const titleW = 28;
    const findingsW = 8;

    const header =
      'ID'.padEnd(idW) + '  ' +
      'Status'.padEnd(statusW) + '  ' +
      'Phase'.padEnd(phaseW) + '  ' +
      'Title'.padEnd(titleW) + '  ' +
      'Findings';
    console.log('\n' + header);
    console.log('─'.repeat(header.length));

    for (const row of rows) {
      console.log(
        String(row.id).padEnd(idW) + '  ' +
        (row.status ?? '').padEnd(statusW) + '  ' +
        (row.phase ?? '').padEnd(phaseW) + '  ' +
        row.title.slice(0, titleW).padEnd(titleW) + '  ' +
        String(row.findingsCount ?? 0),
      );
    }

    await cleanup();
  });

project
  .command('status <id>')
  .description('Show detailed project info')
  .action(async (idStr: string) => {
    const { ctx, cleanup } = await createContext();
    const db = ctx.db;

    const id = parseInt(idStr, 10);
    const [proj] = await db.select().from(projects).where(eq(projects.id, id));

    if (!proj) {
      console.error(`Project ${id} not found.`);
      await cleanup();
      process.exit(1);
    }

    const [pending] = await db
      .select({ count: count() })
      .from(agentTasks)
      .where(and(eq(agentTasks.projectId, id), eq(agentTasks.status, 'pending')));

    const [active] = await db
      .select({ count: count() })
      .from(agentTasks)
      .where(and(eq(agentTasks.projectId, id), eq(agentTasks.status, 'in_progress')));

    console.log(`\nProject [${proj.id}]: ${proj.title}`);
    console.log('─'.repeat(50));
    if (proj.description) {
      console.log(`Description: ${proj.description}`);
    }
    console.log(`Status:      ${proj.status}`);
    console.log(`Phase:       ${proj.phase}`);
    console.log(`Findings:    ${proj.findingsCount ?? 0}`);
    console.log(`Tasks:       ${pending?.count ?? 0} pending, ${active?.count ?? 0} active`);
    if (proj.literatureReview) {
      console.log(`\nLiterature review (excerpt):`);
      console.log(`  ${proj.literatureReview.slice(0, 200)}${proj.literatureReview.length > 200 ? '...' : ''}`);
    }
    if (proj.paperStatus) {
      console.log(`\nPaper status: ${proj.paperStatus}`);
    }
    console.log(`Created: ${proj.createdAt}`);

    await cleanup();
  });

project
  .command('start <id>')
  .description('Set project status to active')
  .action(async (idStr: string) => {
    const { ctx, cleanup } = await createContext();
    const db = ctx.db;

    const id = parseInt(idStr, 10);
    const [updated] = await db
      .update(projects)
      .set({ status: 'active', updatedAt: new Date() })
      .where(eq(projects.id, id))
      .returning();

    if (!updated) {
      console.error(`Project ${id} not found.`);
      await cleanup();
      process.exit(1);
    }

    await db.insert(researchLog).values({
      eventType: 'project_started',
      details: { projectId: id },
    });

    console.log(`Project [${id}] "${updated.title}" is now active.`);
    await cleanup();
  });

project
  .command('pause <id>')
  .description('Set project status to paused')
  .action(async (idStr: string) => {
    const { ctx, cleanup } = await createContext();
    const db = ctx.db;

    const id = parseInt(idStr, 10);
    const [updated] = await db
      .update(projects)
      .set({ status: 'paused', updatedAt: new Date() })
      .where(eq(projects.id, id))
      .returning();

    if (!updated) {
      console.error(`Project ${id} not found.`);
      await cleanup();
      process.exit(1);
    }

    await db.insert(researchLog).values({
      eventType: 'project_paused',
      details: { projectId: id },
    });

    console.log(`Project [${id}] "${updated.title}" is now paused.`);
    await cleanup();
  });

// ─── Run ──────────────────────────────────────────────────────────────────────

program.parse();
