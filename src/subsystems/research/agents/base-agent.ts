export type EvidenceStrength = 'speculation' | 'indication' | 'strong_evidence' | 'proven';

export interface AgentResult {
  finding: string;
  evidenceStrength: EvidenceStrength;
  reasoning: string;
  sources: Array<{ type: string; reference: string; [key: string]: unknown }>;
  metadata?: Record<string, unknown>;
}

export abstract class BaseAgent {
  abstract readonly type: string;
  abstract execute(task: Record<string, unknown>): Promise<AgentResult>;
}
