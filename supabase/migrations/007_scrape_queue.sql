-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA cron;

-- ── scrape_queue table ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scrape_queue (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_date    date        NOT NULL,
  user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status      text        NOT NULL DEFAULT 'pending', -- pending|processing|done|failed
  started_at  timestamptz,
  finished_at timestamptz,
  error       text,
  UNIQUE (run_date, user_id)
);

CREATE INDEX IF NOT EXISTS scrape_queue_run_status ON scrape_queue (run_date, status);

-- ── populate_scrape_queue ─────────────────────────────────────────────────────
-- Called once at 12:00 PM IST on the 1st — inserts all enabled users as pending
CREATE OR REPLACE FUNCTION populate_scrape_queue()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_run_date date := date_trunc('month', now())::date;
  v_count    int;
BEGIN
  INSERT INTO scrape_queue (run_date, user_id)
  SELECT v_run_date, id
  FROM users
  WHERE enabled = true
  ON CONFLICT (run_date, user_id) DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE LOG 'populate_scrape_queue: % users queued for %', v_count, v_run_date;
END;
$$;

-- ── process_scrape_queue ──────────────────────────────────────────────────────
-- Called every 3 min on the 1st — picks next pending user, fires edge function
CREATE OR REPLACE FUNCTION process_scrape_queue()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_row      scrape_queue%ROWTYPE;
  v_gh_id    text;
  v_run_date date := date_trunc('month', now())::date;
BEGIN
  -- Auto-recover rows stuck in processing for > 5 minutes (edge fn crash/timeout)
  UPDATE scrape_queue
  SET status = 'failed', error = 'timeout', finished_at = now()
  WHERE run_date = v_run_date
    AND status   = 'processing'
    AND started_at < now() - interval '5 minutes';

  -- Skip if previous user is still being processed
  IF EXISTS (
    SELECT 1 FROM scrape_queue
    WHERE run_date = v_run_date AND status = 'processing'
  ) THEN
    RETURN;
  END IF;

  -- Pick next pending user (SKIP LOCKED = safe under concurrent calls)
  SELECT * INTO v_row
  FROM scrape_queue
  WHERE run_date = v_run_date AND status = 'pending'
  ORDER BY id
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN; -- Queue empty or all done
  END IF;

  -- Get gh_id for the URL param
  SELECT gh_id INTO v_gh_id FROM users WHERE id = v_row.user_id;

  -- Mark as processing
  UPDATE scrape_queue
  SET status = 'processing', started_at = now()
  WHERE id = v_row.id;

  -- Fire edge function (async via pg_net — no auth needed, verify_jwt = false)
  PERFORM extensions.http_post(
    url     := 'https://madcpkdkamoctiedgghv.supabase.co/functions/v1/scrape-payouts'
               || '?gh_id=' || v_gh_id
               || '&queue_date=' || v_run_date::text,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := '{}'::jsonb
  );
END;
$$;

-- ── pg_cron jobs ──────────────────────────────────────────────────────────────
-- 1. Populate queue: 12:00 PM IST = 06:30 UTC, 1st of every month
SELECT cron.schedule(
  'populate-scrape-queue',
  '30 6 1 * *',
  'SELECT populate_scrape_queue()'
);

-- 2. Process queue: every 3 min, 06:30–13:30 UTC (12:00–7:00 PM IST), 1st only
SELECT cron.schedule(
  'process-scrape-queue',
  '*/3 6-13 1 * *',
  'SELECT process_scrape_queue()'
);
