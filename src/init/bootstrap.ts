import { LLM } from '../llm/llm.js';

export interface BootstrapResult {
  name: string;
  description: string;
  language: string;
  searchTerms: string[];
  agents: Array<{
    name: string;
    prompt: string;
  }>;
  methods: Array<{
    name: string;
    content: string;
  }>;
  strategy: string;
}

const BOOTSTRAP_PROMPT = `You are setting up an autonomous AI research system for a specific academic domain.

Domain: {{domain}}

Your job is to generate a complete project configuration for researching this domain. Think deeply about what a researcher in this field needs.

Generate:

1. **name**: A short kebab-case project name (e.g. "biblical-studies", "quantum-computing")
2. **description**: One sentence describing the research focus
3. **language**: What language should research output be in? Use ISO code (e.g. "en", "no", "de"). Consider what's most natural for the domain and the language the domain was described in.
4. **searchTerms**: 30-60 search terms for DOAJ (Directory of Open Access Journals) to find relevant academic articles. Be specific and varied — cover sub-fields, key concepts, methodologies, important debates. Use English terms for best DOAJ coverage.
5. **agents**: Research agent types suited for this domain. Each agent needs:
   - name: kebab-case identifier (e.g. "linguist", "data-analyst", "literature-reviewer")
   - prompt: A detailed markdown prompt file for the agent. Include: role description, what methods to use (reference files in research/methods/), rules for analysis, evidence strength guidelines. Write as instructions to the agent in the project language.
   Generate 2-5 agents appropriate for the domain.
6. **methods**: Research methodologies relevant to this domain. Each needs:
   - name: kebab-case identifier (e.g. "hermeneutics", "meta-analysis", "grounded-theory")
   - content: A markdown file describing the method, when to use it, strengths/weaknesses, how to apply it in this domain. Write in the project language.
   Generate 3-8 methods.
7. **strategy**: A research strategy markdown document in the project language. Include: current phase (start with "Phase 1: Foundation — building the library and establishing methodology"), priority research areas (5-7 specific topics), epistemological protocol (what each finding must document), and initial research questions.

Reply with JSON:
\`\`\`json
{
  "name": "project-name",
  "description": "one sentence",
  "language": "en",
  "searchTerms": ["term1", "term2"],
  "agents": [{"name": "agent-name", "prompt": "full markdown content"}],
  "methods": [{"name": "method-name", "content": "full markdown content"}],
  "strategy": "full markdown strategy document"
}
\`\`\``;

export async function bootstrapProject(domain: string): Promise<BootstrapResult> {
  console.log('Calling Claude Opus to bootstrap project...');

  const llm = new LLM({
    provider: 'claude',
    model: 'opus',
    allowedTools: ['WebSearch', 'WebFetch'],
  });

  const prompt = LLM.formatPrompt(BOOTSTRAP_PROMPT, { domain });
  const response = await llm.callJSON<BootstrapResult>(prompt);
  return response.data;
}
