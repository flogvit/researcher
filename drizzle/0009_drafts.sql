-- Authoring layer schema (Fase 4 #98).
--
-- Drafts = authored output. Distinct from documents (ingested input).
-- A draft has a body in markdown, a sequence of snapshots (revisions),
-- and a queue of edit proposals from the autonomous loop or chat.

CREATE TABLE IF NOT EXISTS drafts (
  id serial PRIMARY KEY,
  project_id integer REFERENCES projects(id) ON DELETE SET NULL,
  skill varchar(100),       -- skill name the draft was scaffolded from (optional)
  template varchar(100),    -- template name within the skill (optional)
  title text NOT NULL,
  body_md text NOT NULL DEFAULT '',
  research_scope jsonb,     -- keywords/sources/sub-corpus for auto-research (#105)
  status varchar(30) NOT NULL DEFAULT 'draft', -- 'draft' | 'archived' | 'published'
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS drafts_project_idx ON drafts (project_id);
CREATE INDEX IF NOT EXISTS drafts_status_idx ON drafts (status);

CREATE TABLE IF NOT EXISTS draft_revisions (
  id serial PRIMARY KEY,
  draft_id integer NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  body_md text NOT NULL,
  summary text,
  source varchar(50) NOT NULL DEFAULT 'manual', -- 'manual' | 'generator' | 'proposal:<id>'
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS draft_revisions_draft_idx ON draft_revisions (draft_id, created_at DESC);

CREATE TABLE IF NOT EXISTS draft_edit_proposals (
  id serial PRIMARY KEY,
  draft_id integer NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  kind varchar(30) NOT NULL,        -- 'replace' | 'insert'
  range_start integer,              -- character offset (replace)
  range_end integer,                -- character offset (replace)
  section_anchor text,              -- markdown heading path (for rebase)
  original text,
  replacement text NOT NULL,
  rationale text,
  status varchar(20) NOT NULL DEFAULT 'pending', -- 'pending' | 'accepted' | 'rejected' | 'stale'
  source varchar(50),               -- 'chat:<sessionId>' | 'auto-research' | 'manual'
  source_finding_id integer,        -- when from autonomous research, links to findings.id
  created_at timestamp NOT NULL DEFAULT now(),
  resolved_at timestamp
);

CREATE INDEX IF NOT EXISTS draft_edit_proposals_draft_idx ON draft_edit_proposals (draft_id, status);
CREATE INDEX IF NOT EXISTS draft_edit_proposals_status_idx ON draft_edit_proposals (status, created_at DESC);

-- Chat sessions anchored to drafts (#101).
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS draft_id integer REFERENCES drafts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS chat_sessions_draft_idx ON chat_sessions (draft_id);
