import { readFile, writeFile, rename, readdir, rmdir } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Glob } from 'bun';
import { Logger } from './logger';

const log = new Logger('upgrade');

interface UpgradeResult {
  configUpdated: string[];
  moduleConfigsUpdated: string[];
  promptsAdded: string[];
  filesMoved: string[];
  migrationsRun: boolean;
  warnings: string[];
}

/**
 * Deep merge b into a. a values take precedence (user's config wins).
 * Only adds keys from b that don't exist in a.
 */
function deepMergeDefaults(target: Record<string, unknown>, defaults: Record<string, unknown>): string[] {
  const added: string[] = [];

  for (const [key, defaultValue] of Object.entries(defaults)) {
    if (!(key in target)) {
      target[key] = defaultValue;
      added.push(key);
    } else if (
      typeof target[key] === 'object' && target[key] !== null && !Array.isArray(target[key]) &&
      typeof defaultValue === 'object' && defaultValue !== null && !Array.isArray(defaultValue)
    ) {
      const nested = deepMergeDefaults(
        target[key] as Record<string, unknown>,
        defaultValue as Record<string, unknown>,
      );
      added.push(...nested.map(k => `${key}.${k}`));
    }
  }

  return added;
}

export async function upgradeProject(projectDir: string): Promise<UpgradeResult> {
  const result: UpgradeResult = {
    configUpdated: [],
    moduleConfigsUpdated: [],
    promptsAdded: [],
    filesMoved: [],
    migrationsRun: false,
    warnings: [],
  };

  // 1. Upgrade researcher.json — add missing fields
  const configPath = resolve(projectDir, 'researcher.json');
  if (!existsSync(configPath)) {
    result.warnings.push('No researcher.json found. Run "researcher init" first.');
    return result;
  }

  const config = JSON.parse(await readFile(configPath, 'utf-8'));
  const configDefaults: Record<string, unknown> = {
    embedding: {
      model: 'nomic-embed-text',
    },
    orchestrator: {
      dependencyTimeout: 60000,
      dependencyPollInterval: 500,
    },
  };

  // Ensure library.localSources exists
  if (!config.library) config.library = { sources: [] };
  if (!('localSources' in config.library)) {
    config.library.localSources = [];
    result.configUpdated.push('library.localSources');
  }

  // Ensure llm.maxTurns
  if (config.llm && !('maxTurns' in config.llm)) {
    config.llm.maxTurns = 25;
    result.configUpdated.push('llm.maxTurns');
  }

  const added = deepMergeDefaults(config, configDefaults);
  result.configUpdated.push(...added);

  if (result.configUpdated.length > 0) {
    await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
    log.info(`Updated researcher.json: added ${result.configUpdated.join(', ')}`);
  }

  // 2. Upgrade module configs — merge new defaults into existing
  const modulesDir = resolve(projectDir, 'research', 'modules');
  mkdirSync(modulesDir, { recursive: true });

  const defaultModulesDir = resolve(import.meta.dir, '..', 'prompts', 'defaults', 'modules');
  const moduleGlob = new Glob('*.json');

  for await (const file of moduleGlob.scan(defaultModulesDir)) {
    const moduleName = file.replace('.json', '');
    const projectModulePath = resolve(modulesDir, file);
    const defaultContent = JSON.parse(await readFile(resolve(defaultModulesDir, file), 'utf-8'));

    if (existsSync(projectModulePath)) {
      // Merge new fields into existing config
      const existing = JSON.parse(await readFile(projectModulePath, 'utf-8'));
      const moduleAdded = deepMergeDefaults(existing, defaultContent);
      if (moduleAdded.length > 0) {
        await writeFile(projectModulePath, JSON.stringify(existing, null, 2) + '\n');
        result.moduleConfigsUpdated.push(`${moduleName}: ${moduleAdded.join(', ')}`);
        log.info(`Updated ${moduleName}.json: added ${moduleAdded.join(', ')}`);
      }
    } else {
      // Create new module config from defaults
      await writeFile(projectModulePath, JSON.stringify(defaultContent, null, 2) + '\n');
      result.moduleConfigsUpdated.push(`${moduleName}: created`);
      log.info(`Created ${moduleName}.json from defaults`);
    }
  }

  // 3. Add missing default prompts (don't overwrite user's customized ones)
  const promptsDir = resolve(projectDir, 'research', 'prompts');
  mkdirSync(promptsDir, { recursive: true });

  const defaultPromptsDir = resolve(import.meta.dir, '..', 'prompts', 'defaults');
  const promptGlob = new Glob('*.md');

  for await (const file of promptGlob.scan(defaultPromptsDir)) {
    const projectPromptPath = resolve(promptsDir, file);
    if (!existsSync(projectPromptPath)) {
      const content = await readFile(resolve(defaultPromptsDir, file), 'utf-8');
      await writeFile(projectPromptPath, content);
      result.promptsAdded.push(file.replace('.md', ''));
      log.info(`Added missing prompt: ${file}`);
    }
  }

  // 4. Migrate old directory structures
  const oldDirs = [
    resolve(projectDir, 'agents'),
    resolve(projectDir, 'research', 'agents'),
  ];

  for (const oldDir of oldDirs) {
    if (!existsSync(oldDir)) continue;

    const files = await readdir(oldDir);
    const mdFiles = files.filter(f => f.endsWith('.md'));

    for (const file of mdFiles) {
      const oldPath = resolve(oldDir, file);
      const newPath = resolve(promptsDir, file);

      if (existsSync(newPath)) {
        result.warnings.push(`Skipped ${oldDir}/${file} — already exists in research/prompts/`);
        continue;
      }

      await rename(oldPath, newPath);
      const relOld = oldDir.replace(projectDir + '/', '') + '/' + file;
      result.filesMoved.push(`${relOld} → research/prompts/${file}`);
      log.info(`Moved: ${relOld} → research/prompts/${file}`);
    }

    // Remove old directory if only .md files remain (already in prompts/)
    const remaining = await readdir(oldDir);
    const nonMdFiles = remaining.filter(f => !f.endsWith('.md'));
    const skippedMdFiles = remaining.filter(f => f.endsWith('.md') && existsSync(resolve(promptsDir, f)));

    if (remaining.length === 0 || (nonMdFiles.length === 0 && skippedMdFiles.length === remaining.length)) {
      // All remaining files are .md duplicates — safe to remove
      for (const f of remaining) {
        const { unlink } = await import('node:fs/promises');
        await unlink(resolve(oldDir, f));
      }
      await rmdir(oldDir);
      const relDir = oldDir.replace(projectDir + '/', '');
      log.info(`Removed old directory: ${relDir}/`);
      result.filesMoved.push(`${relDir}/ removed (duplicates already in research/prompts/)`);
    } else if (nonMdFiles.length > 0) {
      result.warnings.push(`${oldDir.replace(projectDir + '/', '')}/ has non-.md files — not removed`);
    }
  }

  // 5. Run database migrations
  try {
    const { loadConfig, getDatabaseUrl } = await import('../config.js');
    const cfg = await loadConfig(projectDir);
    const dbUrl = getDatabaseUrl(cfg);

    const { SQL } = await import('bun');
    const { drizzle } = await import('drizzle-orm/bun-sql');
    const { migrate } = await import('drizzle-orm/bun-sql/migrator');

    const client = new SQL(dbUrl);
    await client.unsafe('CREATE EXTENSION IF NOT EXISTS vector');
    const db = drizzle({ client });
    const packageRoot = resolve(import.meta.dir, '..', '..');
    await migrate(db, { migrationsFolder: resolve(packageRoot, 'drizzle') });
    client.close();

    result.migrationsRun = true;
    log.info('Database migrations complete');
  } catch (e) {
    result.warnings.push(`Database migration failed: ${e instanceof Error ? e.message : e}`);
  }

  return result;
}
