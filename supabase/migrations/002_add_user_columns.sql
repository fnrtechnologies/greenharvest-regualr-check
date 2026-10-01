ALTER TABLE users
  ADD COLUMN IF NOT EXISTS bank           text,
  ADD COLUMN IF NOT EXISTS gh_portal_name text,
  ADD COLUMN IF NOT EXISTS inv            bigint;
