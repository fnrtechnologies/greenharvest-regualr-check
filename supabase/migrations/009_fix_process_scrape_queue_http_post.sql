-- 007 called extensions.http_post, which doesn't exist — pg_net exposes its
-- functions under the net schema. Without this fix, process_scrape_queue()
-- silently failed to fire the edge function for each queued user.
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
  PERFORM net.http_post(
    url     := 'https://madcpkdkamoctiedgghv.supabase.co/functions/v1/scrape-payouts'
               || '?gh_id=' || v_gh_id
               || '&queue_date=' || v_run_date::text,
    body    := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
END;
$$;
