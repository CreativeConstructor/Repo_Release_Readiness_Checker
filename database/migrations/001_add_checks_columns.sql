-- Migration 001: Align Checks table with orchestrator requirements on legacy databases.
--
-- Earlier installations may have started with a schema that had:
--   - status CHECK constraint with 'completed' but index used 'complete' (typo)
--   - no head_sha, rule_score, verdict, cached, report, checker_results columns
--   - risks/suggestions columns instead of a single JSONB report
--
-- The current database/init.sql already defines the complete schema. This
-- idempotent migration remains for databases created from the earlier layout.

-- 1. Add new columns (IF NOT EXISTS guards make it re-runnable)
ALTER TABLE Checks
  ADD COLUMN IF NOT EXISTS head_sha       TEXT,
  ADD COLUMN IF NOT EXISTS rule_score     INTEGER,
  ADD COLUMN IF NOT EXISTS verdict        VARCHAR(20),
  ADD COLUMN IF NOT EXISTS cached         BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS report         JSONB,
  ADD COLUMN IF NOT EXISTS checker_results JSONB;

-- 2. Drop the broken index (referenced 'complete' instead of 'completed')
DROP INDEX IF EXISTS idx_checks_cache;

-- 3. Correct cache-lookup index: scoped per user + repo + SHA
--    Only indexes rows that completed successfully (status = 'completed').
CREATE INDEX IF NOT EXISTS idx_checks_cache
  ON Checks(user_id, repo_url, head_sha)
  WHERE status = 'completed';

-- 4. Index for fast history queries per user (most recent first)
CREATE INDEX IF NOT EXISTS idx_checks_user_created
  ON Checks(user_id, created_at DESC);

-- 5. Index for verdict filter in history
CREATE INDEX IF NOT EXISTS idx_checks_verdict
  ON Checks(user_id, verdict)
  WHERE verdict IS NOT NULL;
