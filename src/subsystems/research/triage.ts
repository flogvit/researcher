import { LLM } from '../../llm/llm.js';
import { TRIAGE_TASK } from '../../prompts/defaults.js';

export interface TriageResult {
  verdict: 'proceed' | 'split' | 'skip';
  reason: string;
  subtasks?: Array<{ agentType: string; description: string; priority: number }>;
}

export class Triage {
  constructor(private llm: LLM) {}

  async evaluate(agentType: string, description: string): Promise<TriageResult> {
    const prompt = LLM.formatPrompt(TRIAGE_TASK, { agentType, description });
    try {
      const response = await this.llm.callJSON<TriageResult>(prompt);
      return response.data;
    } catch {
      return { verdict: 'proceed', reason: 'Triage failed, proceeding with original task' };
    }
  }
}
