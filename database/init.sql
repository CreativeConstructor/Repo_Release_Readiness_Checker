CREATE TABLE IF NOT EXISTS Users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique ON Users(username);

CREATE TABLE IF NOT EXISTS Checks (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES Users(id) ON DELETE CASCADE,
  repo_url TEXT NOT NULL,
  repo_name TEXT NOT NULL,
  head_sha TEXT,
  last_commit_hash TEXT,
  rule_score INTEGER,
  verdict VARCHAR(20),
  status VARCHAR(20) DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'failed', 'completed')),
  cached BOOLEAN NOT NULL DEFAULT FALSE,
  report JSONB,
  checker_results JSONB,
  risks JSONB,
  suggestions JSONB,
  checker_data JSONB,
  score INTEGER,
  error_msg TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for commit-SHA caching (user-scoped)
CREATE INDEX IF NOT EXISTS idx_checks_cache
  ON Checks(user_id, repo_url, head_sha)
  WHERE status = 'completed';

-- Index for user history pagination (most recent first)
CREATE INDEX IF NOT EXISTS idx_checks_user_created
  ON Checks(user_id, created_at DESC);

-- Index for filtering by verdict
CREATE INDEX IF NOT EXISTS idx_checks_verdict
  ON Checks(user_id, verdict)
  WHERE verdict IS NOT NULL;
