import { LLM } from '../../llm/llm.js';
import { REFLECT } from '../../prompts/defaults.js';
import { readStrategyFile } from '../../core/state.js';

interface ReflectionResult {
  learnings: string[];
  effectiveMethods: string[];
  nextTasks: Array<{ agentType: string; description: string; priority: number }>;
  rulesUpdate: string | null;
}

export class Reflector {
  constructor(private llm: LLM, private strategyPath: string) {}

  async reflect(completedTasks: Array<{ agentType: string; result: string }>, agentTypes: string[]): Promise<ReflectionResult> {
    const rules = await readStrategyFile(this.strategyPath);
    const prompt = LLM.formatPrompt(REFLECT, {
      researchRules: rules,
      completedTasks: JSON.stringify(completedTasks, null, 2),
      agentTypes: agentTypes.map(t => `- "${t}"`).join('\n'),
    });
    const response = await this.llm.callJSON<ReflectionResult>(prompt);
    return response.data;
  }
}
