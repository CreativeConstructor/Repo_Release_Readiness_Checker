CREATE TABLE IF NOT EXISTS Users (
id SERIAL PRIMARY KEY,
username Varchar(255) NOT NULL,
email VARCHAR(255) UNIQUE NOT NULL,
password_hash VARCHAR(255) NOT NULL,
created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Checks(
   id SERIAL PRIMARY KEY,
   user_id INTEGER NOT NULL REFERENCES Users(id) ON DELETE CASCADE,
   repo_url TEXT NOT NULL,
   repo_name TEXT NOT NULL,
   last_commit_hash TEXT,
   risks JSONB, 
   suggestions JSONB,
   checker_data JSONB,
   status VARCHAR(20) DEFAULT 'pending'
   CHECK (status IN ('pending','processing','failed','completed')),
   score Integer,
   error_msg TEXT,
   created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP

);

CREATE INDEX IF NOT EXISTS idx_checks_cache
ON checks(repo_url,last_commit_hash)
WHERE status='complete';
