# Green Harvest — Payout Scraper + Admin Portal

Monthly payout scraper for multiple users on **greenharvest.live**.
Results are stored in Supabase and shown in a React admin portal hosted on Cloudflare.

## Architecture

| Component | Technology |
|---|---|
| Scraper | Node + Playwright (`src/scrape.mjs`), runs in GitHub Actions |
| Trigger | Supabase pg_cron → `dispatch_scrape()` → GitHub workflow dispatch API |
| Schedule | 1st of every month, 12:00 PM IST (06:30 UTC) |
| Database | Supabase (Postgres) — `users`, `groups`, `payouts`, `earnings`, `scrape_queue`, `scrape_run_summaries` |
| Notifications | Telegram: one summary per month + a screenshot for each failed user |
| Admin UI | React + Vite + Tailwind (`admin/`) |

Flow per run: for each enabled user → log in → `members/payouts.php` (all payout rows) →
`members/incomestatus.php` (total income). Each user's status is written to `scrape_queue`
as it goes, which is what the Dashboard and Scrape Runs pages display. Every run scrapes all
enabled users; at the end the Telegram summary is sent and `scrape_run_summaries` updated.

---

## Setup

### 1. GitHub repository secrets / variables

Settings → Secrets and variables → Actions:

| Name | Kind | Value |
|---|---|---|
| `SUPABASE_URL` | secret | `https://madcpkdkamoctiedgghv.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | secret | Supabase → Project Settings → API |
| `TELEGRAM_BOT_TOKEN` | secret | from @BotFather |
| `TELEGRAM_CHAT_ID` | secret | from `https://api.telegram.org/bot<TOKEN>/getUpdates` |
| `ADMIN_PORTAL_URL` | variable | `https://payout.fnrtechnologiesm.workers.dev` |

### 2. Let Supabase trigger the workflow

Create a fine-grained GitHub PAT limited to this repo with **Actions: Read and write**, then in the
Supabase SQL editor:

```sql
SELECT vault.create_secret('<github_pat>', 'github_dispatch_token');
```

Apply `supabase/migrations/013_github_actions_scrape.sql` — it schedules the monthly
`dispatch-scrape` cron job and creates `dispatch_scrape()`, which the admin portal's Retry
button also calls (it re-runs all users).

### 3. Run manually

- GitHub → Actions → **Scrape** → Run workflow, or
- SQL: `SELECT dispatch_scrape();`, or
- locally: `cp .env.example .env`, fill in the key, then `npm install && npx playwright install chromium && npm run scrape`
  (`npm run scrape:headless` hides the browser).

### 4. Admin portal

```bash
cd admin
cp .env.example .env   # VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
npm install
npm run dev            # local
npm run build          # → dist/
```

---

## Troubleshooting

| Problem | Where to look |
|---|---|
| A user failed | Telegram screenshot; full DOM + error in the workflow run's `failure-debug-*` artifact |
| "Login failed - still on login page" | Check that user's `username`/`password` in the `users` table |
| Nothing ran on the 1st | `SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 5;` and `SELECT * FROM net._http_response ORDER BY created DESC LIMIT 5;` (GitHub returns 204 on success) |
| Telegram silent | `TELEGRAM_*` secrets; the bot must have been messaged first |
