import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { existsSync } from 'node:fs';

/**
 * Skill template format (Fase 4 #107).
 *
 * Templates live under `research/skills/<skill>/templates/<name>.md` and
 * carry optional YAML-style frontmatter declaring the parameters they
 * need and the default LLM prompt for v1 generation:
 *
 *   ---
 *   name: chapter-commentary
 *   description: Verse-by-verse commentary outline
 *   parameters:
 *     - name: book
 *       label: Bible book
 *       required: true
 *     - name: chapter
 *       label: Chapter number
 *       required: true
 *   filter:
 *     keywords: ["commentary", "exegesis"]
 *   ---
 *
 *   # {{book}} {{chapter}} — Commentary
 *
 *   ## Textual notes
 *   ...
 *
 * The body becomes the scaffold passed to the generator (#102).
 */

export interface TemplateParameter {
  name: string;
  label?: string;
  required?: boolean;
  default?: string;
}

export interface DraftTemplate {
  skill: string;
  name: string;
  description?: string;
  parameters: TemplateParameter[];
  filter?: Record<string, unknown>;
  body: string;
}

export async function listSkills(projectDir: string): Promise<string[]> {
  const skillsDir = resolve(projectDir, 'research', 'skills');
  if (!existsSync(skillsDir)) return [];
  const entries = await readdir(skillsDir);
  const out: string[] = [];
  for (const e of entries) {
    const st = await stat(resolve(skillsDir, e));
    if (st.isDirectory()) out.push(e);
  }
  return out;
}

export async function listTemplates(projectDir: string, skill: string): Promise<DraftTemplate[]> {
  const dir = resolve(projectDir, 'research', 'skills', skill, 'templates');
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter(f => f.endsWith('.md'));
  return Promise.all(files.map(f => loadTemplate(projectDir, skill, basename(f, '.md'))));
}

export async function loadTemplate(projectDir: string, skill: string, name: string): Promise<DraftTemplate> {
  const path = resolve(projectDir, 'research', 'skills', skill, 'templates', `${name}.md`);
  const raw = await readFile(path, 'utf-8');
  return parseTemplate(raw, skill, name);
}

function parseTemplate(raw: string, skill: string, name: string): DraftTemplate {
  // Simple YAML-frontmatter parse: '---\n...keys...\n---\n<body>'
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    return { skill, name, parameters: [], body: raw };
  }
  const [, header, body] = match;

  // Minimal YAML reader: top-level scalars + arrays of objects under
  // 'parameters'. Anything fancier than that and users should run their
  // template through a proper YAML preprocessor.
  const out: DraftTemplate = { skill, name, parameters: [], body };
  let currentKey: string | null = null;
  let currentArray: TemplateParameter[] | null = null;
  let currentItem: TemplateParameter | null = null;

  for (const line of header.split('\n')) {
    if (!line.trim()) continue;
    if (/^[A-Za-z_][A-Za-z_0-9]*:/.test(line) && !line.startsWith('  ')) {
      const [k, ...rest] = line.split(':');
      const v = rest.join(':').trim();
      currentKey = k.trim();
      if (currentKey === 'parameters') {
        currentArray = out.parameters;
        currentItem = null;
      } else {
        currentArray = null;
        currentItem = null;
        if (currentKey === 'name') out.name = v.replace(/^['"]|['"]$/g, '');
        else if (currentKey === 'description') out.description = v.replace(/^['"]|['"]$/g, '');
      }
    } else if (line.startsWith('  - ') && currentKey === 'parameters' && currentArray) {
      const rest = line.slice(4).trim();
      const colonIdx = rest.indexOf(':');
      currentItem = { name: '' };
      if (colonIdx > 0) {
        currentItem[rest.slice(0, colonIdx).trim() as keyof TemplateParameter] = rest.slice(colonIdx + 1).trim().replace(/^['"]|['"]$/g, '') as never;
      }
      currentArray.push(currentItem);
    } else if (line.startsWith('    ') && currentItem) {
      const [k, ...rest] = line.trim().split(':');
      const v = rest.join(':').trim().replace(/^['"]|['"]$/g, '');
      if (k === 'required') currentItem.required = v === 'true';
      else if (k === 'name') currentItem.name = v;
      else if (k === 'label') currentItem.label = v;
      else if (k === 'default') currentItem.default = v;
    }
  }

  return out;
}
