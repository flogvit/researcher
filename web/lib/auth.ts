import { NextResponse } from 'next/server';

/**
 * Defends the admin API against the two reachable attacks for a localhost
 * dev tool that listens on a TCP port (issue #1):
 *
 *  1. CSRF — a malicious site visited in another tab can fire
 *     fetch('http://localhost:3051/api/admin/tasks', {...}) and the browser
 *     will dutifully deliver it. We reject these by checking the
 *     `Sec-Fetch-Site` header (sent by all modern browsers) and the
 *     `Origin` / `Host` pair. Same-origin fetches from the dashboard always
 *     pass; cross-site fetches never do.
 *
 *  2. LAN/network exposure — if RESEARCHER_ADMIN_TOKEN is set in the
 *     environment, we additionally require a `Bearer <token>` Authorization
 *     header. Server-side same-origin fetches inside the Next.js app pass
 *     the token through automatically; cross-origin attackers cannot read
 *     env vars and cannot guess the token.
 *
 * The Origin/Site check alone is sufficient defense against the CSRF vector
 * described in #1. The token is the additional layer for deployments that
 * choose to expose the port beyond loopback. Issue #12 (binding the dev
 * server to 127.0.0.1) is the separate fix that limits network reachability.
 */
export function verifyAdminRequest(request: Request): NextResponse | null {
  const site = request.headers.get('sec-fetch-site');
  // 'same-origin' = page-initiated same-host fetch; 'none' = server-side
  // (e.g. SSR) or direct user navigation. 'same-site' is fine too because
  // the only thing on this host is the admin app itself.
  if (site && site !== 'same-origin' && site !== 'none' && site !== 'same-site') {
    return NextResponse.json({ error: 'cross-site requests rejected' }, { status: 403 });
  }

  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (origin && host) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      return NextResponse.json({ error: 'invalid Origin' }, { status: 403 });
    }
    if (originHost !== host) {
      return NextResponse.json({ error: 'Origin does not match Host' }, { status: 403 });
    }
  }

  const requiredToken = process.env.RESEARCHER_ADMIN_TOKEN;
  if (requiredToken) {
    const auth = request.headers.get('authorization') ?? '';
    const provided = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '';
    if (!provided || !timingSafeEqual(provided, requiredToken)) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  return null;
}

/**
 * Constant-time string comparison. We compare full byte sequences so that
 * the time taken does not depend on how many prefix characters match.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
