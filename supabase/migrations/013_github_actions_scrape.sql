-- Scraping moved from the scrape-payouts edge function (Puppeteer + Steel.dev, 150s limit)
-- to a GitHub Actions workflow running Playwright (src/scrape.mjs). The workflow itself
-- creates/updates scrape_queue rows, so the per-user pg_cron queue is no longer needed.
--
-- Requires a Vault secret named github_dispatch_token: a fine-grained GitHub PAT with
-- "Actions: Read and write" on fnrtechnologies/greenharvest-regualr-check.
--   SELECT vault.create_secret('<token>', 'github_dispatch_token');

SELECT cron.unschedule('populate-scrape-queue');
SELECT cron.unschedule('process-scrape-queue');
DROP FUNCTION IF EXISTS populate_scrape_queue();
DROP FUNCTION IF EXISTS process_scrape_queue();

-- Triggers the Scrape workflow, which scrapes all enabled users (cron + admin Retry button).
CREATE OR REPLACE FUNCTION public.dispatch_scrape()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_token text;
  v_request_id bigint;
BEGIN
  SELECT decrypted_secret INTO v_token
  FROM vault.decrypted_secrets WHERE name = 'github_dispatch_token';
  IF v_token IS NULL THEN
    RAISE EXCEPTION 'Vault secret github_dispatch_token is not set';
  END IF;

  SELECT net.http_post(
    url     := 'https://api.github.com/repos/fnrtechnologies/greenharvest-regualr-check/actions/workflows/scrape.yml/dispatches',
    headers := jsonb_build_object(
      'Authorization',        'Bearer ' || v_token,
      'Accept',               'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent',           'greenharvest-dispatch',
      'Content-Type',         'application/json'
    ),
    body    := jsonb_build_object('ref', 'main')
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.dispatch_scrape() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.dispatch_scrape() TO authenticated;

-- 1st of every month at 12:00 PM IST (06:30 UTC)
SELECT cron.schedule('dispatch-scrape', '30 6 1 * *', 'SELECT public.dispatch_scrape()');

-- 008 enabled RLS on scrape_run_summaries without a policy, so the admin portal
-- could never read notified_at. Match the other tables.
CREATE POLICY authenticated_only ON public.scrape_run_summaries
  FOR ALL TO public
  USING (auth.uid() IS NOT NULL);
