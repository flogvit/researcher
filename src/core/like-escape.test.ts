import { describe, expect, test } from 'bun:test';
import { escapeLike } from './like-escape';

describe('escapeLike (#28)', () => {
  test('passes ordinary text through unchanged', () => {
    expect(escapeLike('biblical studies')).toBe('biblical studies');
  });

  test('escapes percent wildcards', () => {
    expect(escapeLike('100% match')).toBe('100\\% match');
  });

  test('escapes underscores', () => {
    expect(escapeLike('foo_bar')).toBe('foo\\_bar');
  });

  test('escapes backslashes', () => {
    expect(escapeLike('a\\b')).toBe('a\\\\b');
  });

  test('escapes all three together', () => {
    expect(escapeLike('a\\b%c_d')).toBe('a\\\\b\\%c\\_d');
  });

  test('handles empty string', () => {
    expect(escapeLike('')).toBe('');
  });
});
