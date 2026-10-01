import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.error("Supabase not configured - set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

export const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

function check(label, { data, error }) {
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

export async function listEnabledUsers() {
  const query = supabase
    .from("users")
    .select("id, gh_id, name, username, password")
    .eq("enabled", true)
    .order("order_no", { ascending: true, nullsFirst: false })
    .order("name");
  return check("listEnabledUsers", await query);
}

/** Ensures a queue row exists for each user and resets it to pending for this run. */
export async function queueUsers(runDate, userIds) {
  const rows = userIds.map((user_id) => ({
    run_date: runDate, user_id, status: "pending", started_at: null, finished_at: null, error: null,
  }));
  check("queueUsers", await supabase.from("scrape_queue").upsert(rows, { onConflict: "run_date,user_id" }));
}

export async function setQueueStatus(runDate, userId, fields) {
  check(
    `setQueueStatus(${userId})`,
    await supabase.from("scrape_queue").update(fields).eq("run_date", runDate).eq("user_id", userId)
  );
}

export async function upsertPayouts(userId, rows) {
  if (rows.length === 0) return 0;
  const scrapedAt = new Date().toISOString();
  // Last row wins if the site lists two payouts in the same month (one row per user/month).
  const byMonth = new Map(rows.map((r) => [r.month_year, r]));
  const records = [...byMonth.values()].map((r) => ({ user_id: userId, ...r, scraped_at: scrapedAt }));
  check(
    `upsertPayouts(${userId})`,
    await supabase.from("payouts").upsert(records, { onConflict: "user_id,month_year" })
  );
  return records.length;
}

export async function upsertEarnings(userId, monthYear, earnings) {
  check(
    `upsertEarnings(${userId})`,
    await supabase.from("earnings").upsert(
      {
        user_id: userId,
        month_year: monthYear,
        total_income: earnings.total_income,
        raw_data: earnings.raw_data,
        scraped_at: new Date().toISOString(),
      },
      { onConflict: "user_id,month_year" }
    )
  );
}

export async function saveRunSummary(runDate, { notified, done, failed }) {
  check(
    "saveRunSummary",
    await supabase.from("scrape_run_summaries").upsert(
      {
        run_date: runDate,
        notified_at: notified ? new Date().toISOString() : null,
        success_count: done,
        fail_count: failed,
      },
      { onConflict: "run_date" }
    )
  );
}

/** Enabled users with their group + payout for the month, for the Telegram table. */
export async function listUsersWithPayouts() {
  return check(
    "listUsersWithPayouts",
    await supabase
      .from("users")
      .select("name, gh_id, groups(name), payouts(amount, month_year)")
      .eq("enabled", true)
      .order("order_no", { ascending: true, nullsFirst: false })
      .order("name")
  );
}
