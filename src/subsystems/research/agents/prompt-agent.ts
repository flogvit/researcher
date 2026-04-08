import { BaseAgent, type AgentResult, type EvidenceStrength } from './base-agent.js';
import { LLM } from '../../../llm/llm.js';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

interface PromptAgentResponse {
  finding: string;
  evidenceStrength: string;
  reasoning: string;
  sources: Array<{ type: string; reference: string }>;
}

export class PromptAgent extends BaseAgent {
  readonly type: string;
  private llm: LLM;
  private promptPath: string;

  constructor(type: string, llm: LLM, projectDir: string) {
    super();
    this.type = type;
    this.llm = llm;
    this.promptPath = resolve(projectDir, 'research', 'agents', `${type}.md`);
  }

  async execute(task: Record<string, unknown>): Promise<AgentResult> {
    let agentPrompt = '';
    if (existsSync(this.promptPath)) {
      agentPrompt = await readFile(this.promptPath, 'utf-8');
    }

    const description = (task.description ?? task.task ?? '') as string;

    const prompt = `${agentPrompt}

Task: ${description}

${task.context ? `Context:\n${task.context}` : ''}

Analyze this thoroughly. Reply with JSON:
\`\`\`json
{
  "finding": "your key finding",
  "evidenceStrength": "speculation|indication|strong_evidence|proven",
  "reasoning": "detailed reasoning",
  "sources": [{"type": "analysis", "reference": "what you analyzed"}]
}
\`\`\``;

    const response = await this.llm.callJSON<PromptAgentResponse>(prompt);
    const data = response.data;

    const validStrengths: EvidenceStrength[] = ['speculation', 'indication', 'strong_evidence', 'proven'];
    const strength = validStrengths.includes(data.evidenceStrength as EvidenceStrength)
      ? data.evidenceStrength as EvidenceStrength
      : 'speculation';

    return {
      finding: data.finding,
      evidenceStrength: strength,
      reasoning: data.reasoning,
      sources: data.sources ?? [],
    };
  }
}
