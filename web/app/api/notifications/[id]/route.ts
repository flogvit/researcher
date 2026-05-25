import { NextResponse } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { verifyAdminRequest } from '@/lib/auth';
import { notificationSubscriptions } from '@researcher/db/schema';
import { eq } from 'drizzle-orm';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = verifyAdminRequest(request);
  if (denied) return denied;
  const { db } = await getServerContext();
  const { id } = await params;
  const body = await request.json() as { enabled?: boolean; config?: Record<string, unknown>; filters?: Record<string, unknown> };

  const updates: Record<string, unknown> = {};
  if (body.enabled !== undefined) updates.enabled = body.enabled;
  if (body.config) updates.config = body.config;
  if (body.filters) updates.filters = body.filters;

  const [row] = await db.update(notificationSubscriptions)
    .set(updates)
    .where(eq(notificationSubscriptions.id, parseInt(id, 10)))
    .returning();

  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(row);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = verifyAdminRequest(request);
  if (denied) return denied;
  const { db } = await getServerContext();
  const { id } = await params;
  const result = await db.delete(notificationSubscriptions)
    .where(eq(notificationSubscriptions.id, parseInt(id, 10)))
    .returning();
  if (result.length === 0) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ status: 'deleted', id: parseInt(id, 10) });
}
