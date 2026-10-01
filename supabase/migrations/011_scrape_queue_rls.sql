-- scrape_queue had RLS disabled, exposing it fully to the anon key. Mirror the
-- authenticated_only policy already used on payouts/earnings/groups/users —
-- the service role (Edge Functions, pg_cron via SECURITY DEFINER) bypasses RLS.
CREATE POLICY authenticated_only ON public.scrape_queue
  FOR ALL TO public
  USING (auth.uid() IS NOT NULL);

ALTER TABLE public.scrape_queue ENABLE ROW LEVEL SECURITY;
