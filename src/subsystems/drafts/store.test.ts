import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { templateDefaultResearchScope } from './templates';

describe('templateDefaultResearchScope (#113)', () => {
  test('returns keywords from filter.keywords', () => {
    expect(templateDefaultResearchScope({
      skill: 'demo',
      name: 'x',
      parameters: [],
      filter: { keywords: ['a', 'b'] },
      body: '',
    })).toEqual({ keywords: ['a', 'b'] });
  });

  test('forwards non-keyword filter fields', () => {
    expect(templateDefaultResearchScope({
      skill: 'demo',
      name: 'x',
      parameters: [],
      filter: { keywords: ['a'], threshold: '0.7' },
      body: '',
    })).toEqual({ keywords: ['a'], threshold: '0.7' });
  });

  test('returns null when no filter', () => {
    expect(templateDefaultResearchScope({
      skill: 'demo',
      name: 'x',
      parameters: [],
      body: '',
    })).toBeNull();
  });

  test('returns null when filter is empty', () => {
    expect(templateDefaultResearchScope({
      skill: 'demo',
      name: 'x',
      parameters: [],
      filter: {},
      body: '',
    })).toBeNull();
  });

  test('drops empty keywords array', () => {
    const r = templateDefaultResearchScope({
      skill: 'demo',
      name: 'x',
      parameters: [],
      filter: { keywords: [] },
      body: '',
    });
    expect(r).toBeNull();
  });
});
