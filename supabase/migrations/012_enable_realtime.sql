-- Enable Supabase Realtime so the admin UI can subscribe to live scrape-run updates.
ALTER PUBLICATION supabase_realtime ADD TABLE scrape_queue;
ALTER PUBLICATION supabase_realtime ADD TABLE scrape_run_summaries;
