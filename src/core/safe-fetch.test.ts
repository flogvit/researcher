import { describe, expect, test } from 'bun:test';
import { assertSafeUrl, SsrfError } from './safe-fetch';

describe('assertSafeUrl (#5, #6 SSRF defense)', () => {
  test('rejects non-http schemes', async () => {
    await expect(assertSafeUrl('file:///etc/passwd')).rejects.toBeInstanceOf(SsrfError);
    await expect(assertSafeUrl('gopher://example.com')).rejects.toBeInstanceOf(SsrfError);
    await expect(assertSafeUrl('javascript:alert(1)')).rejects.toBeInstanceOf(SsrfError);
  });

  test('rejects malformed URLs', async () => {
    await expect(assertSafeUrl('not a url')).rejects.toBeInstanceOf(SsrfError);
  });

  test('rejects literal loopback v4', async () => {
    await expect(assertSafeUrl('http://127.0.0.1/admin')).rejects.toBeInstanceOf(SsrfError);
    await expect(assertSafeUrl('http://127.1.2.3/anything')).rejects.toBeInstanceOf(SsrfError);
  });

  test('rejects literal private v4 ranges', async () => {
    await expect(assertSafeUrl('http://10.0.0.1/')).rejects.toBeInstanceOf(SsrfError);
    await expect(assertSafeUrl('http://192.168.1.1/')).rejects.toBeInstanceOf(SsrfError);
    await expect(assertSafeUrl('http://172.16.0.5/')).rejects.toBeInstanceOf(SsrfError);
    await expect(assertSafeUrl('http://172.31.255.255/')).rejects.toBeInstanceOf(SsrfError);
  });

  test('rejects AWS metadata link-local address', async () => {
    // The exact URL #5 calls out.
    await expect(assertSafeUrl('http://169.254.169.254/latest/meta-data/'))
      .rejects.toBeInstanceOf(SsrfError);
  });

  test('rejects CGNAT range', async () => {
    await expect(assertSafeUrl('http://100.64.0.1/')).rejects.toBeInstanceOf(SsrfError);
  });

  test('rejects literal IPv6 loopback', async () => {
    await expect(assertSafeUrl('http://[::1]/')).rejects.toBeInstanceOf(SsrfError);
  });

  test('rejects IPv6 link-local fe80::/10', async () => {
    await expect(assertSafeUrl('http://[fe80::1]/')).rejects.toBeInstanceOf(SsrfError);
  });

  test('rejects IPv6 ULA fc00::/7', async () => {
    await expect(assertSafeUrl('http://[fc00::1]/')).rejects.toBeInstanceOf(SsrfError);
    await expect(assertSafeUrl('http://[fd12:3456::1]/')).rejects.toBeInstanceOf(SsrfError);
  });

  test('rejects IPv4-mapped IPv6 loopback', async () => {
    await expect(assertSafeUrl('http://[::ffff:127.0.0.1]/')).rejects.toBeInstanceOf(SsrfError);
  });

  test('rejects localhost by name', async () => {
    await expect(assertSafeUrl('http://localhost:3051/api/admin/tasks'))
      .rejects.toBeInstanceOf(SsrfError);
    await expect(assertSafeUrl('http://foo.localhost/'))
      .rejects.toBeInstanceOf(SsrfError);
  });

  test('accepts plausible external URLs', async () => {
    // example.com resolves to public IPs; allowed.
    const url = await assertSafeUrl('https://example.com/');
    expect(url.host).toBe('example.com');
  });
});
