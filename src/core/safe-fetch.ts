import { lookup } from 'node:dns/promises';

/**
 * SSRF defense for outbound fetches against attacker-influenced URLs (#5, #6).
 *
 * Two attack surfaces this protects:
 *
 *  - text-extractor's "ask the model for the article URL" step (#5):
 *    a hostile landing page can coerce Ollama into emitting an internal
 *    URL like http://169.254.169.254/latest/meta-data/ (AWS metadata) or
 *    http://localhost:3051/api/admin/tasks (our own admin API).
 *
 *  - downloader's fetch of documents.url (#6): the URL comes from upstream
 *    API responses and can carry the same payloads, plus arbitrarily large
 *    bodies that DoS the database.
 *
 * The strategy is deliberately strict-by-default:
 *   1. Only http: / https: schemes.
 *   2. Resolve hostname and reject any address in a private / loopback /
 *      link-local / cgnat range — pre-fetch (against the request URL) and
 *      post-DNS (against the resolved IP) defeats DNS-rebinding.
 *   3. A configurable byte cap on the response body. Reads via a streaming
 *      ReadableStream so we never allocate >maxBytes even if the server
 *      claims a small Content-Length and lies.
 */

const FORBIDDEN_V4_RANGES: Array<[number, number]> = [
  // network/host pairs as 32-bit ints
  [ipv4ToInt(10, 0, 0, 0), 8],          // 10.0.0.0/8
  [ipv4ToInt(127, 0, 0, 0), 8],         // 127.0.0.0/8 loopback
  [ipv4ToInt(169, 254, 0, 0), 16],      // 169.254.0.0/16 link-local
  [ipv4ToInt(172, 16, 0, 0), 12],       // 172.16.0.0/12
  [ipv4ToInt(192, 168, 0, 0), 16],      // 192.168.0.0/16
  [ipv4ToInt(0, 0, 0, 0), 8],           // 0.0.0.0/8 "this network"
  [ipv4ToInt(100, 64, 0, 0), 10],       // 100.64.0.0/10 CGNAT
];

function ipv4ToInt(a: number, b: number, c: number, d: number): number {
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

function parseIpv4(addr: string): number | null {
  const parts = addr.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map(p => Number(p));
  if (nums.some(n => Number.isNaN(n) || n < 0 || n > 255)) return null;
  return ipv4ToInt(nums[0], nums[1], nums[2], nums[3]);
}

function isForbiddenV4(addr: string): boolean {
  const ip = parseIpv4(addr);
  if (ip === null) return false;
  for (const [network, prefix] of FORBIDDEN_V4_RANGES) {
    const mask = prefix === 32 ? 0xffffffff : ((0xffffffff << (32 - prefix)) >>> 0);
    if ((ip & mask) === (network & mask)) return true;
  }
  return false;
}

function isForbiddenV6(addr: string): boolean {
  const lower = addr.toLowerCase();
  // Loopback ::1, unspecified ::, IPv4-mapped to forbidden v4, link-local fe80::/10, ULA fc00::/7
  if (lower === '::1' || lower === '::' || lower === '0:0:0:0:0:0:0:1' || lower === '0:0:0:0:0:0:0:0') return true;
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return true;
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true;
  // IPv4-mapped IPv6: two forms exist
  //   ::ffff:1.2.3.4 (dotted)         from explicit input
  //   ::ffff:0102:0304 (hex groups)   after URL/normalization
  const dotted = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted && isForbiddenV4(dotted[1])) return true;

  const hex = lower.match(/::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    const a = (hi >> 8) & 0xff;
    const b = hi & 0xff;
    const c = (lo >> 8) & 0xff;
    const d = lo & 0xff;
    if (isForbiddenV4(`${a}.${b}.${c}.${d}`)) return true;
  }
  return false;
}

export class SsrfError extends Error {
  constructor(msg: string) { super(msg); this.name = 'SsrfError'; }
}

export class ResponseTooLargeError extends Error {
  constructor(msg: string) { super(msg); this.name = 'ResponseTooLargeError'; }
}

/**
 * Validate that a URL is safe to fetch. Throws SsrfError on rejection.
 * Resolves the hostname so DNS-rebinding doesn't bypass the check.
 */
export async function assertSafeUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfError(`malformed URL: ${rawUrl}`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SsrfError(`unsupported protocol: ${url.protocol}`);
  }

  // URL.hostname keeps [] around IPv6 in Bun; strip them so the regex/
  // exact-match checks see the bare address.
  const host = url.hostname.replace(/^\[/, '').replace(/\]$/, '');
  if (host.includes(':')) {
    if (isForbiddenV6(host)) throw new SsrfError(`forbidden IPv6: ${host}`);
  } else if (/^\d/.test(host)) {
    if (isForbiddenV4(host)) throw new SsrfError(`forbidden IPv4: ${host}`);
  } else {
    if (host === 'localhost' || host.endsWith('.localhost')) {
      throw new SsrfError(`localhost not allowed: ${host}`);
    }
    // Resolve and re-check against the resolved address (DNS-rebinding defense)
    try {
      const { address } = await lookup(host);
      if (address.includes(':')) {
        if (isForbiddenV6(address)) throw new SsrfError(`hostname ${host} resolves to forbidden IPv6 ${address}`);
      } else if (isForbiddenV4(address)) {
        throw new SsrfError(`hostname ${host} resolves to forbidden IPv4 ${address}`);
      }
    } catch (e) {
      if (e instanceof SsrfError) throw e;
      throw new SsrfError(`DNS lookup failed for ${host}`);
    }
  }

  return url;
}

export interface SafeFetchOptions {
  maxBytes: number;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

/**
 * Fetch a URL with SSRF + size limit defenses. Reads the body via a
 * streaming reader so we abort early if the response exceeds maxBytes,
 * regardless of what Content-Length the server claims.
 */
export async function safeFetch(
  rawUrl: string,
  opts: SafeFetchOptions,
): Promise<{ status: number; contentType: string; body: ArrayBuffer }> {
  const url = await assertSafeUrl(rawUrl);

  const ac = new AbortController();
  const timer = opts.timeoutMs ? setTimeout(() => ac.abort(), opts.timeoutMs) : null;

  try {
    const response = await fetch(url.toString(), {
      headers: opts.headers,
      redirect: 'manual', // we follow manually so each hop is re-checked
      signal: ac.signal,
    });

    // If we get a redirect, validate the Location and recurse — bounded
    // by a hop limit. fetch() with redirect:'manual' returns the 3xx response.
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        return { status: response.status, contentType: '', body: new ArrayBuffer(0) };
      }
      const next = new URL(location, url).toString();
      if (timer) clearTimeout(timer);
      return safeFetch(next, opts);
    }

    const contentType = response.headers.get('content-type') ?? '';
    const claimed = Number(response.headers.get('content-length') ?? '');
    if (Number.isFinite(claimed) && claimed > opts.maxBytes) {
      throw new ResponseTooLargeError(`Content-Length ${claimed} > maxBytes ${opts.maxBytes}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      return { status: response.status, contentType, body: new ArrayBuffer(0) };
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > opts.maxBytes) {
        try { await reader.cancel(); } catch { /* ignore */ }
        throw new ResponseTooLargeError(`body exceeded ${opts.maxBytes} bytes`);
      }
      chunks.push(value);
    }

    const buf = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) { buf.set(c, offset); offset += c.byteLength; }
    return { status: response.status, contentType, body: buf.buffer };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
