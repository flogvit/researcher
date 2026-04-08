import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface ResearcherState {
  running: boolean;
  startedAt: string | null;
  tasksCompleted: number;
  lastReflection: string | null;
  currentFocus: string | null;
}

const STATE_FILE = '.researcher-state.json';

export async function loadState(projectDir: string): Promise<ResearcherState> {
  const path = resolve(projectDir, STATE_FILE);
  if (!existsSync(path)) {
    return { running: false, startedAt: null, tasksCompleted: 0, lastReflection: null, currentFocus: null };
  }
  return JSON.parse(await readFile(path, 'utf-8'));
}

export async function saveState(projectDir: string, state: ResearcherState): Promise<void> {
  await writeFile(resolve(projectDir, STATE_FILE), JSON.stringify(state, null, 2));
}

export async function readStrategyFile(path: string): Promise<string> {
  if (!existsSync(path)) return '';
  return readFile(path, 'utf-8');
}
