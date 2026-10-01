CREATE TABLE IF NOT EXISTS earnings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month_year   text NOT NULL,
  total_income text,
  raw_data     jsonb,
  scraped_at   timestamptz DEFAULT now(),
  UNIQUE (user_id, month_year)
);

ALTER TABLE earnings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON earnings FOR ALL USING (true);
