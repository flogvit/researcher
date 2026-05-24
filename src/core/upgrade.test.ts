import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { atomicWrite } from './upgrade';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { readdirSync } from 'node:fs';

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await mkdtemp(resolve(tmpdir(), 'researcher-test-'));
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('atomicWrite', () => {
  test('writes a new file', async () => {
    const path = resolve(tmpDir, 'new.json');
    await atomicWrite(path, '{"a":1}');
    expect(await readFile(path, 'utf-8')).toBe('{"a":1}');
  });

  test('overwrites an existing file atomically', async () => {
    const path = resolve(tmpDir, 'over.json');
    await atomicWrite(path, '{"v":"first"}');
    await atomicWrite(path, '{"v":"second"}');
    expect(await readFile(path, 'utf-8')).toBe('{"v":"second"}');
  });

  test('leaves no .tmp sidecar after a successful write', async () => {
    const path = resolve(tmpDir, 'clean.json');
    await atomicWrite(path, '{"clean":true}');
    const siblings = readdirSync(dirname(path)).filter(f => f.startsWith('clean.json.tmp'));
    expect(siblings).toEqual([]);
  });

  test('rename failure cleans up the .tmp file', async () => {
    // Pointing the target into a non-existent directory forces rename() to fail
    // (ENOENT on the parent). The catch in atomicWrite must unlink the tmp.
    const path = resolve(tmpDir, 'no-such-dir', 'broken.json');
    let threw = false;
    try {
      await atomicWrite(path, 'x');
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    // Nothing left behind in the tmpDir root
    const stray = readdirSync(tmpDir).filter(f => f.startsWith('broken.json.tmp'));
    expect(stray).toEqual([]);
    expect(existsSync(path)).toBe(false);
  });
});
