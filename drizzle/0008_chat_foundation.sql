-- Chat Foundation schema (Fase 1, #77).
--
-- Four new tables. The peer_conclusions design borrows from Honcho's
-- dialectic peer modeling — free-text claims with confidence + supersedes
-- chains, vector embeddings for semantic recall. See spec at
-- docs/specs/2026-05-24-chat-foundation-design.md.

CREATE TABLE IF NOT EXISTS chat_sessions (
  id serial PRIMARY KEY,
  scope varchar(100) NOT NULL DEFAULT 'global', -- 'global' or 'project:<name>'
  title text,
  started_at timestamp NOT NULL DEFAULT now(),
  last_turn_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_sessions_scope_idx ON chat_sessions (scope);
CREATE INDEX IF NOT EXISTS chat_sessions_last_turn_idx ON chat_sessions (last_turn_at DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
  id serial PRIMARY KEY,
  session_id integer NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role varchar(20) NOT NULL, -- 'user' | 'assistant' | 'system'
  content text NOT NULL,
  metadata jsonb, -- tool calls, token counts, channel
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_messages_session_idx ON chat_messages (session_id, created_at);

CREATE TABLE IF NOT EXISTS peer_conclusions (
  id serial PRIMARY KEY,
  scope varchar(100) NOT NULL DEFAULT 'global',
  topic varchar(50) NOT NULL, -- 'interests' | 'style' | 'goals' | 'sources' | 'methodology' | 'misc'
  claim text NOT NULL,
  evidence jsonb,
  embedding vector(768),
  confidence real NOT NULL DEFAULT 0.5,
  supersedes integer REFERENCES peer_conclusions(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  source_session_id integer REFERENCES chat_sessions(id) ON DELETE SET NULL,
  source_message_id integer REFERENCES chat_messages(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS peer_conclusions_active_idx ON peer_conclusions (scope, active);
CREATE INDEX IF NOT EXISTS peer_conclusions_topic_idx ON peer_conclusions (topic);
CREATE INDEX IF NOT EXISTS peer_conclusions_vec_idx
  ON peer_conclusions USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 50);

-- Notification subscriptions — schema only in Fase 1; Fase 3 wires up channels.
CREATE TABLE IF NOT EXISTS notification_subscriptions (
  id serial PRIMARY KEY,
  channel varchar(50) NOT NULL, -- 'web_push' | 'email' | 'telegram' | 'desktop'
  config jsonb NOT NULL, -- channel-specific (endpoint, address, chat_id, ...)
  filters jsonb, -- {minRiskLevel?, topics?, sources?}
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notification_subscriptions_enabled_idx ON notification_subscriptions (enabled);
