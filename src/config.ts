import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface SourceConfig {
  type: string;
  enabled: boolean;
  interval: number; // seconds between runs in start mode
  settings: Record<string, unknown>;
}

export interface ProjectConfig {
  name: string;
  description: string;
  language: string; // prompt language (e.g. 'en', 'no')
  database: string; // PostgreSQL database name
  llm: {
    provider: 'claude' | 'ollama';
    model?: string;
    baseUrl?: string;
    allowedTools?: string[];
  };
  library: {
    sources: SourceConfig[];
  };
  research?: {
    agentTypes: string[];
    strategyFile?: string;
    reflectEvery?: number;
  };
  web?: {
    port?: number;
  };
}

export async function loadConfig(projectDir: string): Promise<ProjectConfig> {
  const configPath = resolve(projectDir, 'researcher.json');
  if (!existsSync(configPath)) {
    throw new Error(`No researcher.json found in ${projectDir}. Run 'researcher init' first.`);
  }
  const raw = await readFile(configPath, 'utf-8');
  const config = JSON.parse(raw) as ProjectConfig;

  // Validate required fields
  if (!config.name) throw new Error('researcher.json: "name" is required');
  if (!config.database) throw new Error('researcher.json: "database" is required');
  if (!config.language) config.language = 'en';
  if (!config.llm) throw new Error('researcher.json: "llm" is required');
  if (!config.library) config.library = { sources: [] };

  return config;
}

export function getDatabaseUrl(config: ProjectConfig): string {
  return process.env.DATABASE_URL ?? `postgresql://postgres@localhost:5432/${config.database}`;
}
