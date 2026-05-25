export interface StepConfig {
  name: string;
  agents?: string[];
  enabled?: boolean;
  every?: number; // seconds, for periodic steps (reflect, supervisor)
  batchSize?: number;
  maxTasks?: number;
}

export interface DelayConfig {
  minMs?: number;
  maxMs?: number;
}

export interface ModuleConfig {
  tickInterval?: number;
  minFindings?: number;
  steps: StepConfig[];
  fetchDelay?: DelayConfig;
  downloadDelay?: DelayConfig;
  rateLimitRecoveryCap?: number;
  batchSize?: number;
  maxTasksPerCycle?: number;
  generateWorkCooldown?: number;
  reviewThreshold?: number;
  classifyContentLimit?: number;
  extractorHtmlLimit?: number;
  extractorMinContent?: number;
  extractorModel?: string;
  semanticSearchLimit?: number;
  keywordSearchLimit?: number;
  dependencyTimeout?: number;
  dependencyPollInterval?: number;
  embeddingModel?: string;
  embeddingBatchSize?: number;
  /** Per-source maximum concurrent search-term workers (#44). Defaults vary per plugin. */
  sourceConcurrency?: number;
}

export function randomDelay(config?: DelayConfig): Promise<void> {
  const min = config?.minMs ?? 2000;
  const max = config?.maxMs ?? 10000;
  const ms = min + Math.random() * (max - min);
  return Bun.sleep(ms);
}
