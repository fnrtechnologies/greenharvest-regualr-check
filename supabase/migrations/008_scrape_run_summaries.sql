-- Tracks when the Telegram notification was sent for each monthly scrape run.
-- One row per run_date (e.g. 2026-06-01). Upserted by the edge function after Telegram fires.
CREATE TABLE scrape_run_summaries (
  run_date      date PRIMARY KEY,
  notified_at   timestamptz,
  success_count int NOT NULL DEFAULT 0,
  fail_count    int NOT NULL DEFAULT 0,
  created_at    timestamptz DEFAULT now()
);

ALTER TABLE scrape_run_summaries ENABLE ROW LEVEL SECURITY;
