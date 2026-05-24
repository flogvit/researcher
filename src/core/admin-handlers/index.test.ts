import { describe, expect, test } from 'bun:test';
import { getAdminHandler, listAdminHandlers } from './index';

describe('admin handler registry', () => {
  test('lists all known handlers with a risk level', () => {
    const handlers = listAdminHandlers();
    const types = handlers.map(h => h.type).sort();
    expect(types).toEqual([
      'bootstrap_project',
      'create_agent',
      'delete_agent',
      'modify_config',
      'modify_prompt',
      'modify_researcher_config',
      'run_learner',
    ]);
    for (const h of handlers) {
      expect(['low', 'medium', 'high']).toContain(h.riskLevel);
    }
  });

  test('classifies destructive operations as high-risk', () => {
    const deleteAgent = listAdminHandlers().find(h => h.type === 'delete_agent');
    const modifyResearcher = listAdminHandlers().find(h => h.type === 'modify_researcher_config');
    const bootstrap = listAdminHandlers().find(h => h.type === 'bootstrap_project');
    expect(deleteAgent?.riskLevel).toBe('high');
    expect(modifyResearcher?.riskLevel).toBe('high');
    expect(bootstrap?.riskLevel).toBe('high');
  });

  test('unknown handler type returns undefined', () => {
    expect(getAdminHandler('nonexistent')).toBeUndefined();
  });

  test('handler payload schemas reject invalid input (regression for #54)', () => {
    const h = getAdminHandler('create_agent');
    expect(h).toBeDefined();
    if (!h) return;

    const r1 = h.payloadSchema.safeParse({});
    expect(r1.success).toBe(false);

    const r2 = h.payloadSchema.safeParse({
      name: 'analyst', description: 'x', domain: 'y', language: 'no',
    });
    expect(r2.success).toBe(true);
  });

  test('modify_prompt rejects path traversal in name', () => {
    const h = getAdminHandler('modify_prompt');
    if (!h) throw new Error('handler missing');
    const r = h.payloadSchema.safeParse({ name: '../../../etc/passwd', content: 'x' });
    expect(r.success).toBe(false);
  });

  test('delete_agent rejects slashes in name', () => {
    const h = getAdminHandler('delete_agent');
    if (!h) throw new Error('handler missing');
    const r = h.payloadSchema.safeParse({ name: 'foo/bar' });
    expect(r.success).toBe(false);
  });
});
