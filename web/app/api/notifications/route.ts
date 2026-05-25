import { NextResponse } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { verifyAdminRequest } from '@/lib/auth';
import { notificationSubscriptions } from '@researcher/db/schema';
import { eq } from 'drizzle-orm';

/**
 * Notification subscriptions API (Fase 3 #93).
 *   GET  /api/notifications              list subs
 *   POST /api/notifications              create sub
 *   PATCH /api/notifications/:id         enable/disable + update config
 *   DELETE /api/notifications/:id        remove
 */
export async function GET() {
  const { db } = await getServerContext();
  const rows = await db.select().from(notificationSubscriptions);
  // Redact channel-config secrets in the response.
  return NextResponse.json(rows.map(r => ({
    ...r,
    config: redactConfig(r.config as Record<string, unknown>),
  })));
}

export async function POST(request: Request) {
  const denied = verifyAdminRequest(request);
  if (denied) return denied;
  const { db } = await getServerContext();

  const body = await request.json() as {
    channel: string;
    config: Record<string, unknown>;
    filters?: Record<string, unknown>;
    enabled?: boolean;
  };

  if (!body.channel || !body.config) {
    return NextResponse.json({ error: 'channel + config required' }, { status: 400 });
  }

  const [row] = await db.insert(notificationSubscriptions).values({
    channel: body.channel,
    config: body.config,
    filters: body.filters,
    enabled: body.enabled ?? true,
  }).returning();

  return NextResponse.json(row, { status: 201 });
}

function redactConfig(c: Record<string, unknown>): Record<string, unknown> {
  const SECRETS = /(token|secret|password|apiKey|api[_-]?key|private)/i;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(c)) {
    out[k] = SECRETS.test(k) && typeof v === 'string' && v.length > 0 ? '***' : v;
  }
  return out;
}
