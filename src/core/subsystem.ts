import type { ProjectConfig } from '../config';
import type { getDb } from '../db/connection';
import type { LLM } from '../llm/llm';

export type SubsystemState = 'stopped' | 'starting' | 'running' | 'idle' | 'error';

export interface SubsystemStatus {
  name: string;
  state: SubsystemState;
  ready: boolean;
  stats: Record<string, number | string>;
  lastActivity: Date | null;
  error: string | null;
}

export interface SubsystemContext {
  config: ProjectConfig;
  db: ReturnType<typeof getDb>;
  llm: LLM;
  isReady(subsystemName: string): boolean;
  emit(event: string, data: unknown): void;
  on(event: string, handler: (data: unknown) => void): void;
}

export interface Subsystem {
  readonly name: string;
  readonly dependencies: string[];
  start(ctx: SubsystemContext): Promise<void>;
  update(ctx: SubsystemContext): Promise<void>;
  stop(): Promise<void>;
  status(): Promise<SubsystemStatus>;
}
