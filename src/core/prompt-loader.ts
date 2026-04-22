import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ModuleConfig } from './module-config';

/**
 * Load a prompt by name. Checks project dir first, falls back to shipped defaults.
 * @param projectDir - the project root (where researcher.json lives)
 * @param name - prompt name without extension (e.g. "triage", "ekseget")
 * @returns prompt content as string
 */
export async function loadPrompt(projectDir: string, name: string): Promise<string> {
  // 1. Check project: research/prompts/<name>.md
  const projectPath = resolve(projectDir, 'research', 'prompts', `${name}.md`);
  if (existsSync(projectPath)) {
    return readFile(projectPath, 'utf-8');
  }

  // 2. Fallback: shipped defaults
  const defaultPath = resolve(import.meta.dir, '..', 'prompts', 'defaults', `${name}.md`);
  if (existsSync(defaultPath)) {
    return readFile(defaultPath, 'utf-8');
  }

  throw new Error(`Prompt not found: "${name}" (checked ${projectPath} and ${defaultPath})`);
}

/**
 * Load module config from project dir, with fallback to shipped defaults.
 */
export async function loadModuleConfig(projectDir: string, module: string): Promise<ModuleConfig> {
  // 1. Check project: research/modules/<module>.json
  const projectPath = resolve(projectDir, 'research', 'modules', `${module}.json`);
  if (existsSync(projectPath)) {
    return JSON.parse(await readFile(projectPath, 'utf-8'));
  }

  // 2. Fallback: shipped defaults
  const defaultPath = resolve(import.meta.dir, '..', 'prompts', 'defaults', 'modules', `${module}.json`);
  if (existsSync(defaultPath)) {
    return JSON.parse(await readFile(defaultPath, 'utf-8'));
  }

  throw new Error(`Module config not found: "${module}" (checked ${projectPath} and ${defaultPath})`);
}
