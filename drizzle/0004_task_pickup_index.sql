-- Partial composite index for the queue-claim hot path.
--
-- claimNextTask() in src/core/task-queue.ts does
--   SELECT id FROM agent_tasks
--   WHERE status = 'pending' AND agent_type [LIKE|NOT LIKE] 'admin:%'
--   ORDER BY created_at ASC FOR UPDATE SKIP LOCKED LIMIT 1
--
-- A partial index on the active states keeps the index small (completed/failed
-- rows make up most of the table over time but never satisfy WHERE status =
-- 'pending'). Column order matches the predicate's most-selective-first
-- ordering: status, then agent_type, then created_at for the ORDER BY.
CREATE INDEX IF NOT EXISTS agent_tasks_pickup_idx
  ON agent_tasks (status, agent_type, created_at)
  WHERE status IN ('pending', 'in_progress');
