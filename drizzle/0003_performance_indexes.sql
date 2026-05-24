-- Performance indexes (#36 ANN, #37 btree)

-- ANN index for pgvector cosine search on embeddings.
-- Without this, every searchSimilar is a full sequential scan over the table.
-- ivfflat with lists=100 is a reasonable starting point; revisit after measuring.
CREATE INDEX IF NOT EXISTS embeddings_vec_cosine_idx
  ON embeddings USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Btree indexes for the hot paths that previously did full table scans.
-- isDuplicate (6 source plugins) hits documents.url and documents.title.
-- The web UI's /api/documents ORDER BY scouted_at DESC needs a desc index.
-- novelty-checker joins against discoveries.finding_id.
-- Learner filters review_feedback by processed_by_learner.
CREATE INDEX IF NOT EXISTS documents_url_idx ON documents (url);
CREATE INDEX IF NOT EXISTS documents_title_idx ON documents (title);
CREATE INDEX IF NOT EXISTS documents_scouted_at_idx ON documents (scouted_at DESC);
CREATE INDEX IF NOT EXISTS discoveries_finding_id_idx ON discoveries (finding_id);
CREATE INDEX IF NOT EXISTS findings_project_id_idx ON findings (project_id);
CREATE INDEX IF NOT EXISTS review_feedback_processed_idx ON review_feedback (processed_by_learner);
