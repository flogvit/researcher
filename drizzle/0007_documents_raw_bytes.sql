-- Move PDF storage off the base64-in-TEXT pattern (#24, #39).
--
-- Background: every PDF was stored as a base64 string in documents.raw_content.
-- That's ~33% inflation on the wire, TOAST-rewrites on every UPDATE, and the
-- whole-row OOM hazard when a single PDF exceeds Postgres' field-size limits.
--
-- New scheme:
--   - documents.raw_bytes BYTEA NULL — PDF bytes go here
--   - documents.raw_content TEXT NULL — HTML/text continues here
--   - Either column is populated depending on contentType
--
-- This migration adds the column; the application code (downloader,
-- text-extractor) updates in the same PR to write to raw_bytes for PDFs.
-- Legacy base64 raw_content stays readable until a one-off migration script
-- moves it; the extractor handles both.

ALTER TABLE documents ADD COLUMN IF NOT EXISTS raw_bytes bytea;
