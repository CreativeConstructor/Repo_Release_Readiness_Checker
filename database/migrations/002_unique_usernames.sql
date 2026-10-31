-- Migration 002: Enforce the uniqueness already expected by registration/login.
-- Resolve duplicate usernames before applying this migration if it fails.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM Users
    GROUP BY username
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot add unique username index: duplicate usernames exist';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique
  ON Users(username);
