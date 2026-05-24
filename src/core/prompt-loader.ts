import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ModuleConfig } from './module-config';

/**
 * Cache entry: file content + the mtime at the time of caching.
 *
 * Dispatcher ticks read the same prompts dozens of times per minute and
 * the content rarely changes. We stat() to check mtime (cheap syscall),
 * and only re-read when the file is actually newer than what we cached.
 * See issue #47.
 */
interface CacheEntry<T> {
  value: T;
  mtimeMs: number;
}

const promptCache = new Map<string, CacheEntry<string>>();
const configCache = new Map<string, CacheEntry<ModuleConfig>>();

async function loadWithCache<T>(
  path: string,
  cache: Map<string, CacheEntry<T>>,
  parser: (raw: string) => T,
): Promise<T> {
  const st = await stat(path);
  const cached = cache.get(path);
  if (cached && cached.mtimeMs === st.mtimeMs) {
    return cached.value;
  }
  const raw = await readFile(path, 'utf-8');
  const value = parser(raw);
  cache.set(path, { value, mtimeMs: st.mtimeMs });
  return value;
}

export async function loadPrompt(projectDir: string, name: string): Promise<string> {
  const projectPath = resolve(projectDir, 'research', 'prompts', `${name}.md`);
  if (existsSync(projectPath)) {
    return loadWithCache(projectPath, promptCache, raw => raw);
  }

  const defaultPath = resolve(import.meta.dir, '..', 'prompts', 'defaults', `${name}.md`);
  if (existsSync(defaultPath)) {
    return loadWithCache(defaultPath, promptCache, raw => raw);
  }

  throw new Error(`Prompt not found: "${name}" (checked ${projectPath} and ${defaultPath})`);
}

export async function loadModuleConfig(projectDir: string, module: string): Promise<ModuleConfig> {
  const projectPath = resolve(projectDir, 'research', 'modules', `${module}.json`);
  if (existsSync(projectPath)) {
    return loadWithCache(projectPath, configCache, raw => JSON.parse(raw) as ModuleConfig);
  }

  const defaultPath = resolve(import.meta.dir, '..', 'prompts', 'defaults', 'modules', `${module}.json`);
  if (existsSync(defaultPath)) {
    return loadWithCache(defaultPath, configCache, raw => JSON.parse(raw) as ModuleConfig);
  }

  throw new Error(`Module config not found: "${module}" (checked ${projectPath} and ${defaultPath})`);
}
