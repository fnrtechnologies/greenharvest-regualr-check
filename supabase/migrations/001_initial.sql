-- ── Groups ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS groups (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE,
  created_at timestamptz DEFAULT now()
);

-- ── Users ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gh_id      text NOT NULL UNIQUE,
  name       text NOT NULL,
  username   text NOT NULL,
  password   text NOT NULL,
  group_id   uuid REFERENCES groups(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

-- ── Payouts (one row per user per month) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS payouts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month_year  text NOT NULL,        -- e.g. "2025-06"
  payout_date text,                 -- raw value scraped from site
  amount      text,                 -- raw value scraped from site
  raw_data    jsonb,                -- full column map from site table
  scraped_at  timestamptz DEFAULT now(),
  UNIQUE (user_id, month_year)
);

-- ── Admin users (portal login) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_users (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      text NOT NULL UNIQUE,
  password   text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- ── Row-level security (disable for service-role Edge Function access) ─────────
ALTER TABLE groups      ENABLE ROW LEVEL SECURITY;
ALTER TABLE users       ENABLE ROW LEVEL SECURITY;
ALTER TABLE payouts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;

-- Allow full access via service role (Edge Function uses service role key)
CREATE POLICY "service_role_all" ON groups      FOR ALL USING (true);
CREATE POLICY "service_role_all" ON users       FOR ALL USING (true);
CREATE POLICY "service_role_all" ON payouts     FOR ALL USING (true);
CREATE POLICY "service_role_all" ON admin_users FOR ALL USING (true);
