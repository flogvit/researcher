import { LLM } from '../../llm/llm.js';
import { loadPrompt } from '../../core/prompt-loader.js';
import { readStrategyFile } from '../../core/state.js';

interface ReflectionResult {
  learnings: string[];
  effectiveMethods: string[];
  nextTasks: Array<{ agentType: string; description: string; priority: number }>;
  rulesUpdate: string | null;
}

export class Reflector {
  constructor(private llm: LLM, private strategyPath: string, private projectDir: string) {}

  async reflect(completedTasks: Array<{ agentType: string; result: string }>, agentTypes: string[]): Promise<ReflectionResult> {
    const rules = await readStrategyFile(this.strategyPath);
    const reflectPrompt = await loadPrompt(this.projectDir, 'reflect');
    const prompt = LLM.formatPrompt(reflectPrompt, {
      researchRules: rules,
      completedTasks: JSON.stringify(completedTasks, null, 2),
      agentTypes: agentTypes.map(t => `- "${t}"`).join('\n'),
    });
    const response = await this.llm.callJSON<ReflectionResult>(prompt);
    return response.data;
  }
}
