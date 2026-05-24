-- Full-text and trigram indexes for the research dispatcher's keyword search (#38).
--
-- pg_trgm + GIN turns ILIKE '%word%' from a sequential scan into an index
-- lookup. We index both title (small, hot) and content (large, slower but
-- still much better than seq-scan of multi-MB rows).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS documents_title_trgm_idx
  ON documents USING gin (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS documents_content_trgm_idx
  ON documents USING gin (content gin_trgm_ops);
