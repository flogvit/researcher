import { LLM } from '../../llm/llm.js';
import { GENERATE_WORK } from '../../prompts/defaults.js';
import { readStrategyFile } from '../../core/state.js';

interface GenerateResult {
  reasoning: string;
  tasks: Array<{ agentType: string; description: string; priority: number }>;
}

export class TaskGenerator {
  constructor(private llm: LLM, private strategyPath: string) {}

  async generate(previousFindings: string[], currentFocus: string | null, agentTypes: string[]): Promise<GenerateResult> {
    const rules = await readStrategyFile(this.strategyPath);
    const prompt = LLM.formatPrompt(GENERATE_WORK, {
      researchRules: rules,
      previousFindings: previousFindings.join('\n') || '(none yet)',
      currentFocus: currentFocus ?? 'none',
      agentTypes: agentTypes.map(t => `- "${t}"`).join('\n'),
    });
    const response = await this.llm.callJSON<GenerateResult>(prompt);
    return response.data;
  }
}
