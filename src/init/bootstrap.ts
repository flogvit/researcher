import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { LLM } from '../llm/llm.js';
import { Glob } from 'bun';

export interface BootstrapResult {
  name: string;
  description: string;
  language: string;
  searchTerms: string[];
  agents: Array<{ name: string; prompt: string }>;
  methods: Array<{ name: string; content: string }>;
  strategy: string;
  moduleConfigs: Record<string, object>;
  prompts: Array<{ name: string; content: string }>;
}

// Step 1: Get the project skeleton — name, description, language, search terms, agent names, method names
interface SkeletonResult {
  name: string;
  description: string;
  language: string;
  searchTerms: string[];
  agentNames: string[];
  methodNames: string[];
}

// Step 2: Generate one prompt/agent/method at a time
interface SinglePromptResult {
  content: string;
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

export async function bootstrapProject(domain: string): Promise<BootstrapResult> {
  const llm = new LLM({
    provider: 'claude',
    model: 'opus',
    allowedTools: ['WebSearch', 'WebFetch'],
  });

  console.log('Loading default prompts and module configs...');
  const [defaultPrompts, defaultModuleConfigs] = await Promise.all([
    loadDefaultPrompts(),
    loadDefaultModuleConfigs(),
  ]);
  console.log(`  Found ${defaultPrompts.length} default prompts, ${Object.keys(defaultModuleConfigs).length} module configs`);

  // Step 1: Get project skeleton
  console.log('Step 1: Generating project skeleton...');
  const skeleton = await llm.callJSON<SkeletonResult>(`You are setting up an autonomous AI research system for: ${domain}

Generate the project skeleton. Think about what researchers in this field need.

1. **name**: Short kebab-case project name (e.g. "biblical-studies")
2. **description**: One sentence describing the research focus
3. **language**: ISO code for research output language. Consider what's natural for the domain and how it was described.
4. **searchTerms**: 30-60 DOAJ search terms. Be specific and varied — sub-fields, key concepts, methodologies, debates. English for best DOAJ coverage.
5. **agentNames**: 2-5 kebab-case agent names suited for this domain (e.g. "exegete", "historian", "theologian")
6. **methodNames**: 3-8 kebab-case methodology names relevant to this domain (e.g. "textual-criticism", "comparative-analysis")

Reply with JSON:
\`\`\`json
{
  "name": "project-name",
  "description": "one sentence",
  "language": "en",
  "searchTerms": ["term1", "term2"],
  "agentNames": ["agent1", "agent2"],
  "methodNames": ["method1", "method2"]
}
\`\`\``);

  const sk = skeleton.data;
  console.log(`  Project: ${sk.name} (${sk.language})`);
  console.log(`  Agents: ${sk.agentNames.join(', ')}`);
  console.log(`  Methods: ${sk.methodNames.join(', ')}`);
  console.log(`  Search terms: ${sk.searchTerms.length}`);

  const result: BootstrapResult = {
    name: sk.name,
    description: sk.description,
    language: sk.language,
    searchTerms: sk.searchTerms,
    agents: [],
    methods: [],
    strategy: '',
    moduleConfigs: {},
    prompts: [],
  };

  // Step 2: Generate each agent prompt (plain text, not JSON — prompts are too long for JSON wrapping)
  for (const agentName of sk.agentNames) {
    console.log(`Step 2: Generating agent: ${agentName}...`);
    const resp = await llm.call(`You are setting up a research agent for the domain: ${domain}
Project language: ${sk.language}

Create a detailed markdown prompt file for the agent "${agentName}". Write in the project language.

Include:
- Role description (what this agent does)
- Methods to use (reference files in research/methods/ if relevant: ${sk.methodNames.map(m => m + '.md').join(', ')})
- Rules for analysis
- Evidence strength guidelines (speculation, indication, strong_evidence, proven)
- Output format expectations

Write ONLY the markdown content. No wrapping, no JSON, no code blocks around it.`);
    result.agents.push({ name: agentName, prompt: resp.text });
  }

  // Step 3: Generate each method
  for (const methodName of sk.methodNames) {
    console.log(`Step 3: Generating method: ${methodName}...`);
    const resp = await llm.call(`You are documenting a research methodology for the domain: ${domain}
Project language: ${sk.language}

Create a methodology document for "${methodName}". Write in the project language.

Include:
- What the method is
- When to use it
- Strengths and weaknesses
- How to apply it in this domain
- Quality criteria

Write ONLY the markdown content. No wrapping, no JSON, no code blocks around it.`);
    result.methods.push({ name: methodName, content: resp.text });
  }

  // Step 4: Generate strategy
  console.log('Step 4: Generating research strategy...');
  const stratResp = await llm.call(`You are creating a research strategy for the domain: ${domain}
Project language: ${sk.language}
Available agents: ${sk.agentNames.join(', ')}
Available methods: ${sk.methodNames.join(', ')}

Write a research strategy document in the project language. Include:
- Current phase: "Phase 1: Foundation — building the library and establishing methodology"
- 5-7 priority research areas with descriptions
- Epistemological protocol (what each finding must document)
- 5-6 initial research questions

Write ONLY the markdown content. No wrapping, no JSON, no code blocks around it.`);
  result.strategy = stratResp.text;

  // Step 5: Adapt each default prompt for the domain
  for (const defaultPrompt of defaultPrompts) {
    console.log(`Step 5: Adapting prompt: ${defaultPrompt.name}...`);
    const resp = await llm.call(`You are adapting a system prompt for the domain: ${domain}
Project language: ${sk.language}

Here is the DEFAULT prompt "${defaultPrompt.name}":
---
${defaultPrompt.content}
---

Adapt this prompt for the domain "${domain}". Make it domain-aware:
- Add domain-specific evaluation criteria
- Adjust terminology to fit the field
- Write in the project language (${sk.language})
- Keep the same structure and {{variable}} placeholders
- Keep the same JSON response format (the \`\`\`json blocks must be preserved exactly)

Write ONLY the adapted prompt content. No wrapping, no extra commentary.`);
    result.prompts.push({ name: defaultPrompt.name, content: resp.text });
  }

  // Step 6: Generate module configs
  console.log('Step 6: Generating module configs...');
  const configResp = await llm.callJSON<{ configs: Record<string, object> }>(`You are configuring module pipelines for a research system in the domain: ${domain}

Available agents: ${sk.agentNames.join(', ')}
Default module configs: ${JSON.stringify(defaultModuleConfigs, null, 2)}

Generate adapted module configs for all four modules: research, discovery, paper, library.

For the research module:
- Add the domain agents to the "execute" step
- Add domain-appropriate agents to "review" step if needed (e.g. domain experts as reviewers)
- Keep other steps as defaults unless the domain requires changes

For other modules: keep defaults unless domain-specific adjustments are needed.

Reply with JSON:
\`\`\`json
{
  "configs": {
    "research": {"tickInterval": 2000, "steps": [...]},
    "discovery": {"tickInterval": 5000, "minFindings": 5, "steps": [...]},
    "paper": {"tickInterval": 5000, "steps": [...]},
    "library": {"tickInterval": 2000, "steps": [...]}
  }
}
\`\`\``);
  result.moduleConfigs = configResp.data.configs;

  console.log('Bootstrap complete!');
  return result;
}
