import { LLM } from '../../llm/llm';
import { loadPrompt } from '../../core/prompt-loader';

export interface TriageResult {
  verdict: 'proceed' | 'split' | 'skip';
  reason: string;
  subtasks?: Array<{ agentType: string; description: string; priority: number }>;
}

export class Triage {
  constructor(private llm: LLM, private projectDir: string) {}

  async evaluate(agentType: string, description: string): Promise<TriageResult> {
    const triagePrompt = await loadPrompt(this.projectDir, 'triage');
    const prompt = LLM.formatPrompt(triagePrompt, { agentType, description });
    try {
      const response = await this.llm.callJSON<TriageResult>(prompt);
      return response.data;
    } catch {
      return { verdict: 'proceed', reason: 'Triage failed, proceeding with original task' };
    }
  }
}
