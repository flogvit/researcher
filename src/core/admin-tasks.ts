import { getDb } from '../db/connection';
import { agentTasks, researchLog } from '../db/schema';
import { eq, asc, sql } from 'drizzle-orm';
import { LLM, createLLM } from '../llm/llm';
import type { ProjectConfig } from '../config';
import { Logger } from './logger';
import { writeFile, readFile } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const log = new Logger('admin');
const ADMIN_PREFIX = 'admin:';

interface CreateAgentPayload {
  name: string;
  description: string;
  domain: string;
  language: string;
}

interface ModifyConfigPayload {
  module: string;
  key: string;
  value: unknown;
}

interface RunLearnerPayload {
  force?: boolean;
}

/**
 * Process pending admin tasks from the queue.
 * Returns number of tasks processed.
 */
export async function processAdminTasks(config: ProjectConfig, projectDir: string): Promise<number> {
  const db = getDb();
  let processed = 0;

  while (true) {
    const [task] = await db
      .select()
      .from(agentTasks)
      .where(sql`${agentTasks.status} = 'pending' AND ${agentTasks.agentType} LIKE ${ADMIN_PREFIX + '%'}`)
      .orderBy(asc(agentTasks.createdAt))
      .limit(1);

    if (!task) break;

    await db.update(agentTasks)
      .set({ status: 'in_progress', startedAt: new Date() })
      .where(eq(agentTasks.id, task.id));

    try {
      const taskType = task.agentType.slice(ADMIN_PREFIX.length);
      const payload = task.payload as Record<string, unknown>;
      let result: Record<string, unknown> = {};

      switch (taskType) {
        case 'create_agent':
          result = await handleCreateAgent(payload as unknown as CreateAgentPayload, config, projectDir);
          break;
        case 'modify_config':
          result = await handleModifyConfig(payload as unknown as ModifyConfigPayload, projectDir);
          break;
        case 'run_learner':
          result = await handleRunLearner(payload as unknown as RunLearnerPayload, config, projectDir);
          break;
        case 'modify_prompt':
          result = await handleModifyPrompt(payload as unknown as { name: string; content: string }, projectDir);
          break;
        case 'modify_researcher_config':
          result = await handleModifyResearcherConfig(payload as unknown as { key: string; value: unknown }, projectDir);
          break;
        case 'delete_agent':
          result = await handleDeleteAgent(payload as unknown as { name: string }, projectDir);
          break;
        case 'bootstrap_project':
          result = await handleBootstrapProject(payload as unknown as { domain: string; language: string }, projectDir);
          break;
        default:
          result = { error: `Unknown admin task type: ${taskType}` };
      }

      await db.update(agentTasks)
        .set({ status: 'completed', result, completedAt: new Date() })
        .where(eq(agentTasks.id, task.id));

      await db.insert(researchLog).values({
        eventType: 'admin_task_completed',
        agentType: task.agentType,
        details: { taskId: task.id, result },
      });

      log.info(`Admin task ${task.id} (${taskType}) completed`);
      processed++;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await db.update(agentTasks)
        .set({ status: 'failed', error: message, completedAt: new Date() })
        .where(eq(agentTasks.id, task.id));
      log.error(`Admin task ${task.id} failed: ${message}`);
      processed++;
    }
  }

  return processed;
}

async function handleCreateAgent(
  payload: CreateAgentPayload,
  config: ProjectConfig,
  projectDir: string,
): Promise<Record<string, unknown>> {
  const promptsDir = resolve(projectDir, 'research', 'prompts');
  mkdirSync(promptsDir, { recursive: true });

  const promptPath = resolve(promptsDir, `${payload.name}.md`);
  if (existsSync(promptPath)) {
    return { status: 'skipped', reason: 'Agent prompt already exists' };
  }

  const llm = createLLM('bootstrap', config.llm, config.agents);
  const response = await llm.call(`Create a detailed markdown prompt for a research agent named "${payload.name}".
Domain: ${payload.domain}
Language: ${payload.language}
Description: ${payload.description}

Include: role description, methods, rules for analysis, evidence strength guidelines, output format.
Write ONLY the markdown content.`);

  await writeFile(promptPath, response.text);

  return { status: 'created', path: promptPath, length: response.text.length };
}

async function handleModifyConfig(
  payload: ModifyConfigPayload,
  projectDir: string,
): Promise<Record<string, unknown>> {
  const configPath = resolve(projectDir, 'research', 'modules', `${payload.module}.json`);

  if (!existsSync(configPath)) {
    return { status: 'error', reason: `Module config not found: ${payload.module}` };
  }

  const config = JSON.parse(await readFile(configPath, 'utf-8'));
  const keys = payload.key.split('.');
  let obj = config;
  for (let i = 0; i < keys.length - 1; i++) {
    if (typeof obj[keys[i]] !== 'object' || obj[keys[i]] === null) obj[keys[i]] = {};
    obj = obj[keys[i]];
  }

  const oldValue = obj[keys[keys.length - 1]];
  obj[keys[keys.length - 1]] = payload.value;

  await writeFile(configPath, JSON.stringify(config, null, 2));

  return { status: 'updated', key: payload.key, oldValue, newValue: payload.value };
}

async function handleModifyResearcherConfig(
  payload: { key: string; value: unknown },
  projectDir: string,
): Promise<Record<string, unknown>> {
  const configPath = resolve(projectDir, 'researcher.json');
  if (!existsSync(configPath)) {
    return { status: 'error', reason: 'researcher.json not found' };
  }

  const config = JSON.parse(await readFile(configPath, 'utf-8'));
  const keys = payload.key.split('.');
  let obj = config;
  for (let i = 0; i < keys.length - 1; i++) {
    if (typeof obj[keys[i]] !== 'object' || obj[keys[i]] === null) obj[keys[i]] = {};
    obj = obj[keys[i]];
  }

  const oldValue = obj[keys[keys.length - 1]];
  obj[keys[keys.length - 1]] = payload.value;

  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');

  return { status: 'updated', key: payload.key, oldValue, newValue: payload.value };
}

async function handleModifyPrompt(
  payload: { name: string; content: string },
  projectDir: string,
): Promise<Record<string, unknown>> {
  const promptsDir = resolve(projectDir, 'research', 'prompts');
  mkdirSync(promptsDir, { recursive: true });
  const promptPath = resolve(promptsDir, `${payload.name}.md`);

  const existed = existsSync(promptPath);
  await writeFile(promptPath, payload.content);

  return { status: existed ? 'updated' : 'created', path: promptPath, length: payload.content.length };
}

async function handleBootstrapProject(
  payload: { domain: string; language: string },
  projectDir: string,
): Promise<Record<string, unknown>> {
  const { bootstrapProject } = await import('../init/bootstrap');
  const { basename } = await import('node:path');
  const { writeFileSync, mkdirSync } = await import('node:fs');

  log.info(`Bootstrapping project for domain: ${payload.domain}`);
  const result = await bootstrapProject(payload.domain, payload.language);

  // Write researcher.json
  const configPath = resolve(projectDir, 'researcher.json');
  const dirName = basename(projectDir).toLowerCase().replace(/[^a-z0-9_-]/g, '_');

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

  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

  // Write prompts, methods, strategy, module configs
  const promptsDir = resolve(projectDir, 'research', 'prompts');
  mkdirSync(promptsDir, { recursive: true });
  for (const agent of result.agents) {
    writeFileSync(resolve(promptsDir, `${agent.name}.md`), agent.prompt);
  }
  for (const method of result.methods) {
    const dir = resolve(projectDir, 'research', 'methods');
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, `${method.name}.md`), method.content);
  }
  mkdirSync(resolve(projectDir, 'research'), { recursive: true });
  writeFileSync(resolve(projectDir, 'research', 'strategy.md'), result.strategy);

  if (result.moduleConfigs) {
    const dir = resolve(projectDir, 'research', 'modules');
    mkdirSync(dir, { recursive: true });
    for (const [name, mc] of Object.entries(result.moduleConfigs)) {
      writeFileSync(resolve(dir, `${name}.json`), JSON.stringify(mc, null, 2) + '\n');
    }
  }
  if (result.prompts) {
    for (const p of result.prompts) {
      writeFileSync(resolve(promptsDir, `${p.name}.md`), p.content);
    }
  }

  // Create database
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
    const packageRoot = resolve(import.meta.dir, '..', '..');
    await migrate(db, { migrationsFolder: resolve(packageRoot, 'drizzle') });
    migrationClient.close();
  } catch (e) {
    log.error(`Database setup failed: ${e instanceof Error ? e.message : e}`);
    return { status: 'partial', error: `Database setup failed: ${e instanceof Error ? e.message : e}`, config };
  }

  return {
    status: 'complete',
    name: result.name,
    agents: result.agents.length,
    methods: result.methods.length,
    sources: result.recommendedSources?.length ?? 1,
  };
}

async function handleDeleteAgent(
  payload: { name: string },
  projectDir: string,
): Promise<Record<string, unknown>> {
  const promptPath = resolve(projectDir, 'research', 'prompts', `${payload.name}.md`);
  if (!existsSync(promptPath)) {
    return { status: 'not_found', name: payload.name };
  }

  const { unlink } = await import('node:fs/promises');
  await unlink(promptPath);
  return { status: 'deleted', name: payload.name };
}

async function handleRunLearner(
  payload: RunLearnerPayload,
  config: ProjectConfig,
  projectDir: string,
): Promise<Record<string, unknown>> {
  const { Learner } = await import('./learner');
  const { loadModuleConfig } = await import('./prompt-loader');
  const paperConfig = await loadModuleConfig(projectDir, 'paper');
  const llm = createLLM('learner', config.llm, config.agents);
  const learner = new Learner(llm, projectDir, paperConfig);

  const didLearn = payload.force
    ? await learner.forceLearn()
    : await learner.maybeLearn();

  return { status: didLearn ? 'completed' : 'no_reviews', forced: payload.force ?? false };
}
