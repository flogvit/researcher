import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { verifyAdminRequest } from './auth';

function req(headers: Record<string, string>): Request {
  return new Request('http://localhost:3051/api/admin/tasks', {
    method: 'POST',
    headers,
  });
}

describe('verifyAdminRequest', () => {
  const origToken = process.env.RESEARCHER_ADMIN_TOKEN;
  beforeEach(() => { delete process.env.RESEARCHER_ADMIN_TOKEN; });
  afterEach(() => {
    if (origToken === undefined) delete process.env.RESEARCHER_ADMIN_TOKEN;
    else process.env.RESEARCHER_ADMIN_TOKEN = origToken;
  });

  test('allows same-origin requests (#1 — same-page fetch)', async () => {
    const result = verifyAdminRequest(req({
      'sec-fetch-site': 'same-origin',
      'origin': 'http://localhost:3051',
      'host': 'localhost:3051',
    }));
    expect(result).toBeNull();
  });

  test('allows server-side fetches with no Sec-Fetch-Site header', async () => {
    const result = verifyAdminRequest(req({}));
    expect(result).toBeNull();
  });

  test('rejects cross-site requests — the CSRF vector from #1', async () => {
    const result = verifyAdminRequest(req({
      'sec-fetch-site': 'cross-site',
      'origin': 'http://evil.example',
      'host': 'localhost:3051',
    }));
    expect(result).not.toBeNull();
    expect(result?.status).toBe(403);
  });

  test('rejects Origin that does not match Host', async () => {
    const result = verifyAdminRequest(req({
      'origin': 'http://evil.example',
      'host': 'localhost:3051',
    }));
    expect(result).not.toBeNull();
    expect(result?.status).toBe(403);
  });

  test('with RESEARCHER_ADMIN_TOKEN set, rejects missing Authorization', async () => {
    process.env.RESEARCHER_ADMIN_TOKEN = 'secret-token-xyz';
    const result = verifyAdminRequest(req({
      'sec-fetch-site': 'same-origin',
    }));
    expect(result?.status).toBe(401);
  });

  test('with RESEARCHER_ADMIN_TOKEN set, rejects wrong Bearer token', async () => {
    process.env.RESEARCHER_ADMIN_TOKEN = 'secret-token-xyz';
    const result = verifyAdminRequest(req({
      'sec-fetch-site': 'same-origin',
      'authorization': 'Bearer wrong-token',
    }));
    expect(result?.status).toBe(401);
  });

  test('with RESEARCHER_ADMIN_TOKEN set, accepts correct Bearer token', async () => {
    process.env.RESEARCHER_ADMIN_TOKEN = 'secret-token-xyz';
    const result = verifyAdminRequest(req({
      'sec-fetch-site': 'same-origin',
      'authorization': 'Bearer secret-token-xyz',
    }));
    expect(result).toBeNull();
  });

  test('with RESEARCHER_ADMIN_TOKEN set, rejects same-length-but-different token (timing-safe)', async () => {
    process.env.RESEARCHER_ADMIN_TOKEN = 'aaaaaa';
    const result = verifyAdminRequest(req({
      'sec-fetch-site': 'same-origin',
      'authorization': 'Bearer aaaaab',
    }));
    expect(result?.status).toBe(401);
  });
});
