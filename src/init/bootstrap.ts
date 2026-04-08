import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { LLM } from '../llm/llm.js';
import { Glob } from 'bun';

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
  moduleConfigs: {
    research: object;
    discovery: object;
    paper: object;
    library: object;
  };
  prompts: Array<{
    name: string;
    content: string;
  }>;
}

async function loadDefaultPrompts(): Promise<Array<{ name: string; content: string }>> {
  const defaultsDir = resolve(import.meta.dir, '..', 'prompts', 'defaults');
  const results: Array<{ name: string; content: string }> = [];
  const glob = new Glob('*.md');
  for await (const file of glob.scan(defaultsDir)) {
    const name = file.replace(/\.md$/, '');
    const content = await readFile(resolve(defaultsDir, file), 'utf-8');
    results.push({ name, content });
  }
  return results.sort((a, b) => a.name.localeCompare(b.name));
}

async function loadDefaultModuleConfigs(): Promise<Record<string, object>> {
  const modulesDir = resolve(import.meta.dir, '..', 'prompts', 'defaults', 'modules');
  const configs: Record<string, object> = {};
  const glob = new Glob('*.json');
  for await (const file of glob.scan(modulesDir)) {
    const name = file.replace(/\.json$/, '');
    const content = await readFile(resolve(modulesDir, file), 'utf-8');
    configs[name] = JSON.parse(content);
  }
  return configs;
}

const BOOTSTRAP_PROMPT = `You are setting up an autonomous AI research system for: {{domain}}

Below are the DEFAULT prompts and module configurations for the research system. Your job is to:

1. **Adapt each prompt** for the domain — add domain expertise, use the appropriate language (detect from how the domain was described), adjust terminology and evaluation criteria to fit the field.
2. **Create domain-specific research agents** (2-5) with full prompt files.
3. **Adjust module configs** — add the domain agents to appropriate steps, adjust settings (tick intervals, thresholds) if needed for the domain.
4. **Generate methods and strategy** as appropriate for the domain.

## Default prompts to adapt:
{{defaultPrompts}}

## Default module configs:
{{defaultModuleConfigs}}

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
8. **moduleConfigs**: Adapted module configurations. Must include all four modules: research, discovery, paper, library. Each follows the ModuleConfig format with steps array. Add the domain agents to the "execute" step in research config. Keep the structure but adjust settings for the domain.
9. **prompts**: All adapted prompts. Include every prompt from the defaults list above (adapted for the domain), PLUS any new prompts needed. Each prompt needs a name (kebab-case, no extension) and content (full markdown).

Reply with JSON:
\`\`\`json
{
  "name": "project-name",
  "description": "one sentence",
  "language": "en",
  "searchTerms": ["term1", "term2"],
  "agents": [{"name": "agent-name", "prompt": "full markdown content"}],
  "methods": [{"name": "method-name", "content": "full markdown content"}],
  "strategy": "full markdown strategy document",
  "moduleConfigs": {
    "research": {"tickInterval": 2000, "minFindings": 5, "steps": [...]},
    "discovery": {"steps": [...]},
    "paper": {"steps": [...]},
    "library": {"steps": [...]}
  },
  "prompts": [{"name": "triage", "content": "adapted prompt"}, ...]
}
\`\`\``;

function formatDefaultPrompts(prompts: Array<{ name: string; content: string }>): string {
  return prompts.map(p => `### ${p.name}.md\n\`\`\`\n${p.content}\n\`\`\``).join('\n\n');
}

function formatDefaultModuleConfigs(configs: Record<string, object>): string {
  return Object.entries(configs)
    .map(([name, config]) => `### ${name}.json\n\`\`\`json\n${JSON.stringify(config, null, 2)}\n\`\`\``)
    .join('\n\n');
}

export async function bootstrapProject(domain: string): Promise<BootstrapResult> {
  console.log('Loading default prompts and module configs...');
  const [defaultPrompts, defaultModuleConfigs] = await Promise.all([
    loadDefaultPrompts(),
    loadDefaultModuleConfigs(),
  ]);

  console.log(`  Found ${defaultPrompts.length} default prompts: ${defaultPrompts.map(p => p.name).join(', ')}`);
  console.log(`  Found ${Object.keys(defaultModuleConfigs).length} default module configs: ${Object.keys(defaultModuleConfigs).join(', ')}`);

  console.log('Calling Claude Opus to bootstrap project...');

  const llm = new LLM({
    provider: 'claude',
    model: 'opus',
    allowedTools: ['WebSearch', 'WebFetch'],
  });

  const prompt = BOOTSTRAP_PROMPT
    .replace('{{domain}}', domain)
    .replace('{{defaultPrompts}}', formatDefaultPrompts(defaultPrompts))
    .replace('{{defaultModuleConfigs}}', formatDefaultModuleConfigs(defaultModuleConfigs));

  const response = await llm.callJSON<BootstrapResult>(prompt);
  return response.data;
}
