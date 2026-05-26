import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listSkills, listTemplates, loadTemplate } from './templates';

let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'researcher-templates-'));
  const skillDir = join(tmp, 'research', 'skills', 'demo', 'templates');
  mkdirSync(skillDir, { recursive: true });

  writeFileSync(join(skillDir, 'with-filter.md'), `---
name: with-filter
description: Template that declares a filter scope
parameters:
  - name: topic
    label: Topic
    required: true
filter:
  keywords:
    - alpha
    - beta gamma
  threshold: "0.7"
---

# {{topic}}
`);

  writeFileSync(join(skillDir, 'flow-array.md'), `---
name: flow-array
description: Flow-style array
filter:
  keywords: ["x", "y", "z"]
---

body
`);

  writeFileSync(join(skillDir, 'no-frontmatter.md'), '# Body only\n');
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('templates', () => {
  test('listSkills finds skill directories', async () => {
    expect(await listSkills(tmp)).toEqual(['demo']);
  });

  test('listTemplates returns parsed templates', async () => {
    const ts = await listTemplates(tmp, 'demo');
    expect(ts.map(t => t.name).sort()).toEqual(['flow-array', 'no-frontmatter', 'with-filter']);
  });

  test('parses parameters', async () => {
    const t = await loadTemplate(tmp, 'demo', 'with-filter');
    expect(t.parameters).toEqual([
      { name: 'topic', label: 'Topic', required: true },
    ]);
  });

  test('parses filter block-style array (#112)', async () => {
    const t = await loadTemplate(tmp, 'demo', 'with-filter');
    expect(t.filter).toEqual({
      keywords: ['alpha', 'beta gamma'],
      threshold: '0.7',
    });
  });

  test('parses filter flow-style array (#112)', async () => {
    const t = await loadTemplate(tmp, 'demo', 'flow-array');
    expect(t.filter).toEqual({ keywords: ['x', 'y', 'z'] });
  });

  test('templates without frontmatter still load', async () => {
    const t = await loadTemplate(tmp, 'demo', 'no-frontmatter');
    expect(t.parameters).toEqual([]);
    expect(t.filter).toBeUndefined();
    expect(t.body.trim()).toBe('# Body only');
  });

  test('body is preserved verbatim after frontmatter', async () => {
    const t = await loadTemplate(tmp, 'demo', 'with-filter');
    expect(t.body.trim()).toBe('# {{topic}}');
  });
});
