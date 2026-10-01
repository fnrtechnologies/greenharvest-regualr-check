// Monthly payout scrape: logs in to greenharvest.live as each enabled user, saves payouts +
// earnings to Supabase, tracks per-user status in scrape_queue (read by the admin portal),
// and sends one Telegram summary when the month's queue has no open rows left.
//
//   node src/scrape.mjs [--headless] [--gh-id GH123456]
//
// GH_ID / RUN_DATE env vars work too (used by the GitHub workflow inputs).
import path from "node:path";
import {
  listEnabledUsers, queueUsers, setQueueStatus, queueCounts,
  upsertPayouts, upsertEarnings, saveRunSummary, listUsersWithPayouts,
} from "./db.mjs";
import { launchBrowser, newPage, login, scrapePayouts, scrapeEarnings } from "./site.mjs";
import { captureFailure } from "./debug.mjs";
import { sendSummary, notifyPhoto } from "./telegram.mjs";

const args = process.argv.slice(2);
const headless = args.includes("--headless");
const ghIdArg = args.includes("--gh-id") ? args[args.indexOf("--gh-id") + 1] : process.env.GH_ID;
const ghId = ghIdArg?.trim() || null;

const now = new Date();
const monthYear = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
const runDate = process.env.RUN_DATE?.trim() || `${monthYear}-01`;

const users = await listEnabledUsers(ghId);
if (users.length === 0) {
  console.error(ghId ? `No enabled user with gh_id ${ghId}` : "No enabled users");
  process.exit(1);
}
console.log(`Run ${runDate}: ${users.length} user(s)${ghId ? ` (gh_id ${ghId})` : ""}`);

await queueUsers(runDate, users.map((u) => u.id));

const browser = await launchBrowser({ headless });
const failures = [];

for (const user of users) {
  const tag = `${user.name} (${user.gh_id})`;
  console.log(`\n-> ${tag}`);
  await setQueueStatus(runDate, user.id, { status: "processing", started_at: new Date().toISOString() });

  const page = await newPage(browser);
  let step = "login";
  try {
    await login(page, user);
    step = "payouts";
    const payouts = await scrapePayouts(page);
    step = "earnings";
    const earnings = await scrapeEarnings(page);

    step = "db";
    const saved = await upsertPayouts(user.id, payouts);
    await upsertEarnings(user.id, monthYear, earnings);
    console.log(`   ${saved} payout month(s), total income ${earnings.total_income || "?"}`);

    await setQueueStatus(runDate, user.id, { status: "done", finished_at: new Date().toISOString(), error: null });
  } catch (err) {
    const error = `${step}: ${err.message.split("\n")[0]}`;
    console.error(`   FAILED at ${error}`);
    const dir = await captureFailure(page, { ghId: user.gh_id, step, err });
    failures.push({ name: user.name, ghId: user.gh_id, error });
    await setQueueStatus(runDate, user.id, { status: "failed", finished_at: new Date().toISOString(), error });
    await notifyPhoto(path.join(dir, "screenshot.png"), `🟠 <b>Scrape failed</b> for ${tag} at <code>${step}</code>`);
  } finally {
    await page.context().close();
  }
}

await browser.close();

const counts = await queueCounts(runDate);
if (counts.open === 0) {
  const notified = await sendSummary({
    users: await listUsersWithPayouts(),
    monthYear,
    done: counts.done,
    failed: counts.failed,
    failures,
  });
  await saveRunSummary(runDate, { notified, done: counts.done, failed: counts.failed });
  console.log(`\nQueue complete: ${counts.done} done, ${counts.failed} failed. Telegram ${notified ? "sent" : "NOT sent"}.`);
}

if (failures.length > 0) process.exit(1);
