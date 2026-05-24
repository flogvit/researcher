import { describe, expect, test } from 'bun:test';
import { extractJSON } from './llm';

describe('extractJSON', () => {
  test('parses a bare JSON object', () => {
    const r = extractJSON<{ a: number }>('{"a":1}');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.a).toBe(1);
  });

  test('parses a JSON array', () => {
    const r = extractJSON<number[]>('[1,2,3]');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toEqual([1, 2, 3]);
  });

  test('prefers a ```json fenced block', () => {
    const text = 'Sure thing.\n```json\n{"verdict":"split"}\n```\nThat is my answer.';
    const r = extractJSON<{ verdict: string }>(text);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.verdict).toBe('split');
  });

  test('also accepts an unlabeled ``` fenced block', () => {
    const text = 'Reply:\n```\n{"ok":true}\n```';
    const r = extractJSON<{ ok: boolean }>(text);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.ok).toBe(true);
  });

  test('does NOT match prose with stray braces around real JSON (regression for #18)', () => {
    // Old greedy /\{[\s\S]*\}/ would match from the first '{' (in prose) to the
    // last '}' (also prose) and parse garbage. The balanced scanner must skip
    // the prose-only {} braces and pick the real JSON object.
    const text = `I would consider this {something} carefully.
The answer is: {"action":"keep"}.
Note also that {this} is unrelated.`;
    const r = extractJSON<{ action: string }>(text);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.action).toBe('keep');
  });

  test('ignores braces inside strings', () => {
    const r = extractJSON<{ note: string }>('{"note":"contains {} braces"}');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.note).toBe('contains {} braces');
  });

  test('handles escaped quotes in strings', () => {
    const r = extractJSON<{ q: string }>('{"q":"he said \\"hi\\""}');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.q).toBe('he said "hi"');
  });

  test('handles nested objects', () => {
    const r = extractJSON<{ a: { b: { c: number } } }>('Result: {"a":{"b":{"c":42}}} done.');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.a.b.c).toBe(42);
  });

  test('returns error when no JSON is present', () => {
    const r = extractJSON('just some prose, no objects here at all');
    expect(r.ok).toBe(false);
  });

  test('skips a broken candidate and finds a valid one later', () => {
    const text = 'broken: {not valid json} then: {"valid":true}';
    const r = extractJSON<{ valid: boolean }>(text);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.valid).toBe(true);
  });

  test('handles fenced block with surrounding whitespace', () => {
    const text = '```json\n\n  {"x":1}  \n\n```';
    const r = extractJSON<{ x: number }>(text);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.x).toBe(1);
  });
});
