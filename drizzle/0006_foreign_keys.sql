-- Foreign keys for referential integrity (#70).
--
-- Each ADD CONSTRAINT is preceded by a NULL-out of any dangling references
-- so the migration succeeds on existing data with broken pointers (e.g. a
-- discovery whose finding_id no longer points at an existing finding).
--
-- The discriminator-column refactor from #70 (typed kind/queue column on
-- agent_tasks) is intentionally deferred. The queue partition is already
-- enforced by claimNextTask('admin'|'research') in src/core/task-queue.ts
-- (#51); adding a column requires updating every writer site, which is a
-- larger change and currently has no read-path benefit beyond the existing
-- agentType LIKE 'admin:%' predicate.

-- discoveries.finding_id → findings.id
UPDATE discoveries SET finding_id = NULL
  WHERE finding_id IS NOT NULL
    AND finding_id NOT IN (SELECT id FROM findings);

-- The schema currently declares discoveries.finding_id as NOT NULL. Relax
-- to nullable so the ON DELETE SET NULL is legal.
ALTER TABLE discoveries ALTER COLUMN finding_id DROP NOT NULL;

ALTER TABLE discoveries
  ADD CONSTRAINT discoveries_finding_id_fkey
  FOREIGN KEY (finding_id) REFERENCES findings(id) ON DELETE SET NULL;

-- agent_tasks.project_id → projects.id
UPDATE agent_tasks SET project_id = NULL
  WHERE project_id IS NOT NULL
    AND project_id NOT IN (SELECT id FROM projects);

ALTER TABLE agent_tasks
  ADD CONSTRAINT agent_tasks_project_id_fkey
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;

-- findings.project_id → projects.id
UPDATE findings SET project_id = NULL
  WHERE project_id IS NOT NULL
    AND project_id NOT IN (SELECT id FROM projects);

ALTER TABLE findings
  ADD CONSTRAINT findings_project_id_fkey
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;

-- findings.task_id → agent_tasks.id
UPDATE findings SET task_id = NULL
  WHERE task_id IS NOT NULL
    AND task_id NOT IN (SELECT id FROM agent_tasks);

ALTER TABLE findings
  ADD CONSTRAINT findings_task_id_fkey
  FOREIGN KEY (task_id) REFERENCES agent_tasks(id) ON DELETE SET NULL;
