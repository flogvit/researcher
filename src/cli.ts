#!/usr/bin/env bun
import { Command } from 'commander';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { migrate } from 'drizzle-orm/bun-sql/migrator';
import { eq, sql, desc, count, and } from 'drizzle-orm';
import { loadConfig, getDatabaseUrl, type ProjectConfig } from './config.js';
import { bootstrapProject } from './init/bootstrap.js';
import { initDatabase, getDb, getClient } from './db/connection.js';
import { documents, agentTasks, findings, projects, researchLog } from './db/schema.js';
import { LLM } from './llm/llm.js';
import { LibrarySubsystem } from './subsystems/library/index.js';
import { ResearchSubsystem } from './subsystems/research/index.js';
import { DiscoverySubsystem } from './subsystems/discovery/index.js';
import { PaperSubsystem } from './subsystems/paper/index.js';
import { Orchestrator } from './core/orchestrator.js';
import { loadState, saveState } from './core/state.js';
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
  .command('init [domain]')
  .description('Initialize a new research project. Provide a domain for AI-bootstrapped setup.')
  .action(async (domain?: string) => {
    const cwd = process.cwd();
    const configPath = resolve(cwd, 'researcher.json');

    const dirName = basename(cwd).toLowerCase().replace(/[^a-z0-9_-]/g, '_');

    let config: ProjectConfig;

    if (existsSync(configPath)) {
      // Config already exists — just set up database
      config = await loadConfig(cwd);
      console.log(`Using existing researcher.json (${config.name})`);
    } else if (domain) {
      // AI-bootstrapped setup
      const result = await bootstrapProject(domain);

      config = {
        name: result.name,
        description: result.description,
        language: result.language,
        database: `researcher_${result.name.replace(/-/g, '_')}`,
        llm: {
          provider: 'claude',
          model: 'sonnet',
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

      // Write agents
      const agentsDir = resolve(cwd, 'research', 'agents');
      mkdirSync(agentsDir, { recursive: true });
      for (const agent of result.agents) {
        writeFileSync(resolve(agentsDir, `${agent.name}.md`), agent.prompt);
        console.log(`  Created agent: ${agent.name}`);
      }

      // Write methods
      const methodsDir = resolve(cwd, 'research', 'methods');
      mkdirSync(methodsDir, { recursive: true });
      for (const method of result.methods) {
        writeFileSync(resolve(methodsDir, `${method.name}.md`), method.content);
        console.log(`  Created method: ${method.name}`);
      }

      // Write strategy
      const researchDir = resolve(cwd, 'research');
      mkdirSync(researchDir, { recursive: true });
      writeFileSync(resolve(researchDir, 'strategy.md'), result.strategy);
      console.log('  Created strategy');
    } else {
      // Create blank defaults
      const dbName = `researcher_${dirName}`;
      config = {
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
        research: {
          agentTypes: [],
          strategyFile: 'research/strategy.md',
          reflectEvery: 3,
        },
      };

      writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
      console.log('Created researcher.json');
    }

    // Create research/ directory with empty strategy.md (if not already created by bootstrap)
    const researchDir = resolve(cwd, 'research');
    if (!existsSync(researchDir)) {
      mkdirSync(researchDir, { recursive: true });
    }
    const strategyPath = resolve(researchDir, 'strategy.md');
    if (!existsSync(strategyPath)) {
      writeFileSync(strategyPath, '# Research Strategy\n\n');
    }

    const dbName = config.database;

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
    // Ensure pgvector extension exists
    await migrationClient.unsafe('CREATE EXTENSION IF NOT EXISTS vector');
    const db = drizzle({ client: migrationClient });
    const packageRoot = resolve(import.meta.dir, '..'); // src/ -> package root
    await migrate(db, { migrationsFolder: resolve(packageRoot, 'drizzle') });
    migrationClient.close();
    console.log('Migrations complete.');

    console.log(`\nProject "${config.name}" initialized successfully.`);
    if (domain) {
      console.log('Next steps:');
      console.log('  1. Review researcher.json and research/ files');
      console.log('  2. Run "researcher library start" to begin collecting documents');
    } else {
      console.log('Next steps:');
      console.log('  1. Edit researcher.json to configure sources');
      console.log('  2. Edit research/strategy.md to define your research focus');
      console.log('  3. Run "researcher library start" to begin collecting documents');
    }
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

// ─── start (top-level orchestrator) ───────────────────────────────────────────

program
  .command('start')
  .description('Start all subsystems')
  .action(async () => {
    const { ctx, cleanup } = await createContext();
    const orchestrator = new Orchestrator();
    orchestrator.register(new LibrarySubsystem());
    orchestrator.register(new ResearchSubsystem());
    orchestrator.register(new DiscoverySubsystem());
    orchestrator.register(new PaperSubsystem());

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

// ─── web ────────────────────────────────────────────────────────────────────

program
  .command('web')
  .description('Start the web dashboard')
  .option('--port <port>', 'Port to listen on', '3051')
  .action(async (opts) => {
    const { startWebServer } = await import('./web/server.js');
    startWebServer(parseInt(opts.port), process.cwd());
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
