import { NextResponse } from 'next/server';
import { getServerContext } from '@/lib/server-context';

const SECRET_KEY_PATTERN = /(apikey|api[_-]?key|password|token|secret|authorization)/i;

/**
 * Walk an object tree and replace string values under any secret-looking
 * key with '***'. Defends the /api/config GET response against the leak
 * path described in #13: settings.apiKey on source plugins is otherwise
 * returned verbatim to any reader.
 */
function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_PATTERN.test(k) && typeof v === 'string' && v.length > 0) {
        out[k] = '***';
      } else {
        out[k] = redactSecrets(v);
      }
    }
    return out;
  }
  return value;
}

export async function GET() {
  try {
    const { config } = await getServerContext();
    return NextResponse.json(redactSecrets(config));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
