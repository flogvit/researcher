import { sql } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { agentTasks, documents } from '../db/schema';
import type { InferSelectModel } from 'drizzle-orm';
import { Logger } from './logger';

export const ADMIN_PREFIX = 'admin:';

type AgentTask = InferSelectModel<typeof agentTasks>;
type Document = InferSelectModel<typeof documents>;

const log = new Logger('queue');

/**
 * Atomically claim the next pending task for a queue partition.
 *
 * The SELECT side uses `FOR UPDATE SKIP LOCKED` so that two concurrent
 * processes (CLI worker + web admin processor, or two ticks of the same
 * dispatcher) never claim the same row. The outer UPDATE flips status to
 * 'in_progress' in the same statement and returns the row.
 *
 * Pass `partition` to scope the claim:
 *   - 'admin'    → only rows where agent_type LIKE 'admin:%'
 *   - 'research' → only rows where agent_type NOT LIKE 'admin:%'
 *
 * Without partitioning, the research dispatcher would grab admin tasks and
 * execute them as if they were research tasks (issue #51).
 */
export async function claimNextTask(partition: 'admin' | 'research'): Promise<AgentTask | null> {
  const db = getDb();
  const adminPattern = `${ADMIN_PREFIX}%`;
  const filter = partition === 'admin'
    ? sql`agent_type LIKE ${adminPattern}`
    : sql`agent_type NOT LIKE ${adminPattern}`;

  const result = await db.execute<AgentTask>(sql`
    UPDATE agent_tasks
    SET status = 'in_progress', started_at = NOW()
    WHERE id = (
      SELECT id FROM agent_tasks
      WHERE status = 'pending' AND ${filter}
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING *
  `);

  const row = (result as unknown as { rows?: AgentTask[] }).rows?.[0]
    ?? (Array.isArray(result) ? (result as AgentTask[])[0] : undefined);
  return row ?? null;
}

/**
 * Atomically claim the next document waiting to be downloaded.
 * Same FOR UPDATE SKIP LOCKED pattern, applied to the documents table.
 */
export async function claimNextDownload(): Promise<{ id: number; url: string; title: string } | null> {
  const db = getDb();

  const result = await db.execute<Document>(sql`
    UPDATE documents
    SET status = 'downloading', downloaded_at = NULL
    WHERE id = (
      SELECT id FROM documents
      WHERE status = 'metadata' AND url IS NOT NULL
      ORDER BY scouted_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, url, title
  `);

  const row = (result as unknown as { rows?: Document[] }).rows?.[0]
    ?? (Array.isArray(result) ? (result as Document[])[0] : undefined);
  if (!row || !row.url) return null;
  return { id: row.id, url: row.url, title: row.title };
}

/**
 * Reset tasks left in 'in_progress' by a crashed process.
 *
 * A task is considered stale when started_at is older than `staleAfterMs`.
 * The default (10 min) is generous; pick a value larger than the longest
 * legitimate task duration to avoid stealing live work.
 *
 * Called at subsystem startup. See issue #15.
 */
export async function recoverStaleTasks(staleAfterMs = 10 * 60_000): Promise<number> {
  const db = getDb();
  const seconds = Math.floor(staleAfterMs / 1000);

  const result = await db.execute<{ id: number }>(sql`
    UPDATE agent_tasks
    SET status = 'pending', started_at = NULL
    WHERE status = 'in_progress'
      AND (started_at IS NULL OR started_at < NOW() - (${seconds}::text || ' seconds')::interval)
    RETURNING id
  `);

  const rows = (result as unknown as { rows?: { id: number }[] }).rows
    ?? (Array.isArray(result) ? (result as { id: number }[]) : []);
  if (rows.length > 0) {
    log.info(`Recovered ${rows.length} stale in_progress tasks: ${rows.map(r => r.id).join(', ')}`);
  }
  return rows.length;
}

/**
 * Reset documents stuck in 'downloading' from a crashed process.
 */
export async function recoverStaleDownloads(staleAfterMs = 5 * 60_000): Promise<number> {
  const db = getDb();
  const seconds = Math.floor(staleAfterMs / 1000);

  const result = await db.execute<{ id: number }>(sql`
    UPDATE documents
    SET status = 'metadata'
    WHERE status = 'downloading'
      AND (downloaded_at IS NULL AND scouted_at < NOW() - (${seconds}::text || ' seconds')::interval)
    RETURNING id
  `);

  const rows = (result as unknown as { rows?: { id: number }[] }).rows
    ?? (Array.isArray(result) ? (result as { id: number }[]) : []);
  if (rows.length > 0) {
    log.info(`Recovered ${rows.length} stale downloads`);
  }
  return rows.length;
}
