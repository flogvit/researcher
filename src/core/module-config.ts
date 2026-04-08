export interface StepConfig {
  name: string;
  agents?: string[];
  enabled?: boolean;
  every?: number; // seconds, for periodic steps (reflect, supervisor)
}

export interface ModuleConfig {
  tickInterval?: number;
  minFindings?: number;
  steps: StepConfig[];
}
