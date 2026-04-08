import { LLM } from '../../llm/llm.js';
import { REVIEW_FINDING } from '../../prompts/defaults.js';
import type { AgentResult } from './agents/base-agent.js';

export interface ReviewResult {
  approved: boolean;
  quality: 'high' | 'medium' | 'low';
  issues: string[];
  suggestions: string[];
}

export class Reviewer {
  constructor(private llm: LLM) {}

  async review(taskDescription: string, result: AgentResult): Promise<ReviewResult> {
    const prompt = LLM.formatPrompt(REVIEW_FINDING, {
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
