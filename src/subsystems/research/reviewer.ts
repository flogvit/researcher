import { LLM } from '../../llm/llm';
import { loadPrompt } from '../../core/prompt-loader';
import type { AgentResult } from './agents/base-agent';

export interface ReviewResult {
  approved: boolean;
  quality: 'high' | 'medium' | 'low';
  issues: string[];
  suggestions: string[];
}

export class Reviewer {
  constructor(private llm: LLM, private projectDir: string) {}

  async review(taskDescription: string, result: AgentResult): Promise<ReviewResult> {
    const reviewPrompt = await loadPrompt(this.projectDir, 'review');
    const prompt = LLM.formatPrompt(reviewPrompt, {
      taskDescription,
      finding: result.finding,
      reasoning: result.reasoning,
      evidenceStrength: result.evidenceStrength,
    });
    try {
      const response = await this.llm.callJSON<ReviewResult>(prompt);
      return response.data;
    } catch {
      return { approved: true, quality: 'medium', issues: ['Review failed'], suggestions: [] };
    }
  }
}
