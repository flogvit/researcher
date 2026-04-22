import { LLM } from '../../llm/llm';
import { loadPrompt } from '../../core/prompt-loader';
import { readStrategyFile } from '../../core/state';

interface GenerateResult {
  reasoning: string;
  tasks: Array<{ agentType: string; description: string; priority: number }>;
}

export class TaskGenerator {
  constructor(private llm: LLM, private strategyPath: string, private projectDir: string) {}

  async generate(previousFindings: string[], currentFocus: string | null, agentTypes: string[]): Promise<GenerateResult> {
    const rules = await readStrategyFile(this.strategyPath);
    const generatePrompt = await loadPrompt(this.projectDir, 'generate-work');
    const prompt = LLM.formatPrompt(generatePrompt, {
      researchRules: rules,
      previousFindings: previousFindings.join('\n') || '(none yet)',
      currentFocus: currentFocus ?? 'none',
      agentTypes: agentTypes.map(t => `- "${t}"`).join('\n'),
    });
    const response = await this.llm.callJSON<GenerateResult>(prompt);
    return response.data;
  }
}
