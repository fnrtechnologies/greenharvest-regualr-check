// ─────────────────────────────────────────────────────────────────────────────
// scrape-payouts — Supabase Edge Function
// Stack: Puppeteer (puppeteer-core) + Steel.dev headless browser + Supabase
//
// Flow (per user): login → Payouts page (all rows) → Earnings page (total income)
// Every run backfills missing payout history and snapshots current earnings.
// Triggers: HTTP request (on-demand) + cron (1st of month, 12PM IST / 06:30 UTC)
// ─────────────────────────────────────────────────────────────────────────────

// @ts-ignore — npm: imports are resolved by Deno runtime, not the local TS checker
import puppeteer        from "npm:puppeteer-core@21.11.0";
import { createClient } from "npm:@supabase/supabase-js@2";

// ── Secrets ───────────────────────────────────────────────────────────────────
const STEEL_API_KEY    = Deno.env.get("STEEL_API_KEY")!;
const PAYOUT_SITE_URL  = Deno.env.get("PAYOUT_SITE_URL")!;  // https://greenharvest.live
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected by the Edge Function runtime
const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TELEGRAM_TOKEN   = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID") ?? "";
const ADMIN_PORTAL_URL = Deno.env.get("ADMIN_PORTAL_URL") ?? "";

// ── Debug & browser timeout config ────────────────────────────────────────────
const DEBUG = true;   // set false in production to reduce log noise
const T = {
  goto    : 30_000,   // page.goto
  nav     : 30_000,   // waitForNavigation after click
  selector: 15_000,   // waitInPage (element / link appears)
  settle  : 1_000,    // waitForTimeout after table loads
};


// ── Selectors ─────────────────────────────────────────────────────────────────
const SELECTORS = {
  usernameInput   : 'input[name="userid"]',
  passwordInput   : 'input[name="password"]',
  submitButton    : 'button[type="submit"]',
  payoutsLinkText : "Payouts",
  earningsLinkText: "Earnings",
  payoutTable     : "table",
};

// ── Types ─────────────────────────────────────────────────────────────────────
interface User {
  id       : string;
  gh_id    : string;
  name     : string;
  username : string;
  password : string;
}

interface PayoutRow {
  month_year  : string;
  payout_date : string;
  amount      : string;
  raw_data    : Record<string, string>;
}

interface EarningsSnapshot {
  total_income : string;
  raw_data     : Record<string, string>[];
}

interface ScrapeResult {
  userId   : string;
  ghId     : string;
  success  : boolean;
  rows?    : PayoutRow[];
  earnings?: EarningsSnapshot;
  error?   : string;
}

// ── Entry point ───────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  const supabase  = createClient(SUPABASE_URL, SUPABASE_KEY);
  const monthYear = getMonthYear();

  const params      = new URL(req.url).searchParams;
  const ghIdFilter  = params.get("gh_id");
  const queueDate   = params.get("queue_date"); // set by process_scrape_queue() DB fn

  // 1. Fetch users
  let query = supabase
    .from("users")
    .select("id, gh_id, name, username, password")
    .eq("enabled", true);
  if (ghIdFilter) query = query.eq("gh_id", ghIdFilter);

  const { data: users, error: fetchErr } = await query;

  if (fetchErr || !users?.length) {
    const msg = fetchErr?.message ?? "No users found";
    console.error("Failed to fetch users:", msg);
    return json({ success: false, error: msg }, 500);
  }

  console.log(`Processing ${users.length} user(s)…${ghIdFilter ? ` (filter: ${ghIdFilter})` : ""}`);

  // 2. Scrape each user sequentially
  const results: ScrapeResult[] = [];
  let totalPayoutsUpserted = 0;

  for (const user of users as User[]) {
    console.log(`\n── User: ${user.name} (${user.gh_id}) ──`);
    const result = await scrapeUser(user);
    results.push(result);

    if (result.success) {
      for (const row of result.rows ?? []) {
        const { error } = await supabase.from("payouts").upsert(
          {
            user_id    : user.id,
            month_year : row.month_year,
            payout_date: row.payout_date,
            amount     : row.amount,
            raw_data   : row.raw_data,
            scraped_at : new Date().toISOString(),
          },
          { onConflict: "user_id,month_year" }
        );
        if (error) console.error(`Payout upsert failed ${user.gh_id} ${row.month_year}:`, error.message);
        else totalPayoutsUpserted++;
      }

      if (result.earnings) {
        const { error } = await supabase.from("earnings").upsert(
          {
            user_id     : user.id,
            month_year  : monthYear,
            total_income: result.earnings.total_income,
            raw_data    : result.earnings.raw_data,
            scraped_at  : new Date().toISOString(),
          },
          { onConflict: "user_id,month_year" }
        );
        if (error) console.error(`Earnings upsert failed ${user.gh_id}:`, error.message);
        else console.log(`Earnings upserted for ${user.gh_id}: ${result.earnings.total_income}`);
      }
    }

    // 3. Update scrape_queue row if this call was triggered by the queue
    if (queueDate) {
      const queueUpdate = result.success
        ? { status: "done",   finished_at: new Date().toISOString(), error: null }
        : { status: "failed", finished_at: new Date().toISOString(), error: result.error ?? "unknown" };

      await supabase.from("scrape_queue")
        .update(queueUpdate)
        .eq("run_date", queueDate)
        .eq("user_id",  user.id);

      console.log(`Queue row updated: ${user.gh_id} → ${queueUpdate.status}`);
    }
  }

  const successCount = results.filter((r) => r.success).length;
  const failCount    = results.filter((r) => !r.success).length;

  // 4. Telegram: if queue-driven, only notify when entire queue is done
  if (queueDate) {
    const { count } = await supabase
      .from("scrape_queue")
      .select("*", { count: "exact", head: true })
      .eq("run_date", queueDate)
      .in("status", ["pending", "processing"]);

    if (count === 0) {
      // All users processed — fetch final totals and notify
      const { data: qSummary } = await supabase
        .from("scrape_queue")
        .select("status")
        .eq("run_date", queueDate);
      const totalDone   = qSummary?.filter((r: { status: string }) => r.status === "done").length   ?? 0;
      const totalFailed = qSummary?.filter((r: { status: string }) => r.status === "failed").length ?? 0;
      const { count: payoutsTotal } = await supabase
        .from("payouts")
        .select("*", { count: "exact", head: true })
        .gte("scraped_at", queueDate);
      const notified = await sendTelegram(supabase, totalDone, totalFailed, payoutsTotal ?? 0, monthYear);
      await supabase.from("scrape_run_summaries").upsert(
        {
          run_date     : queueDate,
          notified_at  : notified ? new Date().toISOString() : null,
          success_count: totalDone,
          fail_count   : totalFailed,
        },
        { onConflict: "run_date" }
      );
      console.log(notified ? "Queue complete — Telegram sent." : "Queue complete — Telegram NOT sent (see logs above).");
    }
  } else {
    // Direct call (manual / test) — always send Telegram
    const notified = await sendTelegram(supabase, successCount, failCount, totalPayoutsUpserted, monthYear);
    await supabase.from("scrape_run_summaries").upsert(
      {
        run_date     : `${monthYear}-01`,
        notified_at  : notified ? new Date().toISOString() : null,
        success_count: successCount,
        fail_count   : failCount,
      },
      { onConflict: "run_date" }
    );
  }

  return json({ success: true, monthYear, successCount, failCount, totalPayoutsUpserted, results });
});

// ── Scrape one user ───────────────────────────────────────────────────────────
async function scrapeUser(user: User): Promise<ScrapeResult> {
  const tag = `[${user.name} - ${user.gh_id}]`;
  const log  = (...a: unknown[]) => console.log(tag, ...a);
  const udbg = (...a: unknown[]) => { if (DEBUG) console.log("[DBG]", tag, ...a); };
  const utimed = <T>(label: string, fn: () => Promise<T>) => {
    const t0 = Date.now();
    return fn().then((r) => { if (DEBUG) console.log(`[DBG] ✓ ${tag} ${label} — ${Date.now() - t0}ms`); return r; });
  };

  let sessionId: string | undefined;
  // deno-lint-ignore no-explicit-any
  let browser: any;
  // deno-lint-ignore no-explicit-any
  let page: any;

  try {
    // ── Steel session ─────────────────────────────────────────────────────────
    const sessionRes = await fetch("https://api.steel.dev/v1/sessions", {
      method : "POST",
      headers: { "Content-Type": "application/json", "Steel-Api-Key": STEEL_API_KEY },
      body   : JSON.stringify({}),
    });
    if (!sessionRes.ok) throw new Error(`Steel session error: ${await sessionRes.text()}`);
    const session = await sessionRes.json();
    sessionId = session.id;
    log(`Steel session: ${session.id}`);

    // ── Connect Puppeteer via CDP ─────────────────────────────────────────────
    udbg("connecting puppeteer over CDP…");
    browser = await puppeteer.connect({
      browserWSEndpoint: `wss://connect.steel.dev?apiKey=${STEEL_API_KEY}&sessionId=${session.id}`,
    });
    const pages = await browser.pages();
    page = pages[0] ?? await browser.newPage();
    udbg("page acquired");
    await page.setViewport({ width: 1920, height: 1080 });

    // ── Login ─────────────────────────────────────────────────────────────────
    await utimed("goto homepage", () =>
      page.goto(PAYOUT_SITE_URL, { waitUntil: "domcontentloaded", timeout: T.goto })
    );
    udbg("homepage loaded, url:", page.url());

    await utimed("goto login.html", () =>
      page.goto(`${PAYOUT_SITE_URL}/login.html`, { waitUntil: "networkidle2", timeout: T.goto })
    );
    udbg("login.html loaded, url:", page.url());

    await utimed("wait usernameInput", () =>
      waitInPage(page, hasSelector, SELECTORS.usernameInput, "login form", T.selector)
    );

    await utimed("fill credentials", () =>
      page.evaluate(
        (uSel: string, pSel: string, uVal: string, pVal: string) => {
          (document.querySelector(uSel) as HTMLInputElement).value = uVal;
          (document.querySelector(pSel) as HTMLInputElement).value = pVal;
        },
        SELECTORS.usernameInput, SELECTORS.passwordInput, user.username, user.password
      )
    );

    await utimed("click submit + waitForNavigation", () =>
      Promise.all([
        page.waitForNavigation({ waitUntil: "networkidle2", timeout: T.nav }),
        page.evaluate((sel: string) => (document.querySelector(sel) as HTMLButtonElement)?.click(), SELECTORS.submitButton),
      ])
    );
    udbg("post-login url:", page.url());

    if (await page.evaluate(hasSelector, SELECTORS.usernameInput)) {
      throw new Error("Login failed — still on login page.");
    }
    log("Logged in. URL:", page.url());

    // ── Payouts page ─────────────────────────────────────────────────────────
    await utimed("wait Payouts link", () =>
      waitInPage(page, hasLinkText, SELECTORS.payoutsLinkText, "Payouts link", T.selector)
    );
    await utimed("click Payouts + waitForNavigation", () =>
      Promise.all([
        page.waitForNavigation({ waitUntil: "networkidle2", timeout: T.nav }),
        page.evaluate((text: string) => {
          const link = Array.from(document.querySelectorAll("a"))
            .find((a) => (a as HTMLAnchorElement).textContent?.includes(text)) as HTMLAnchorElement;
          link?.click();
        }, SELECTORS.payoutsLinkText),
      ])
    );
    udbg("payouts page url:", page.url());

    await utimed("wait payoutTable", () =>
      waitInPage(page, hasSelector, SELECTORS.payoutTable, "payout table", T.selector)
    );
    await utimed("settle payouts", () => page.waitForTimeout(T.settle));

    const rawRows = await utimed("evaluate payout rows", () => page.evaluate(() => {
      const headers = Array.from(document.querySelectorAll("thead th, thead td"))
        .map((th) => th.textContent?.trim() ?? "");
      return Array.from(document.querySelectorAll("tbody tr")).map((row) => {
        const cells = Array.from(row.querySelectorAll("td"))
          .map((td) => td.textContent?.trim() ?? "");
        return headers.length > 0
          ? Object.fromEntries(headers.map((h, i) => [h || `col_${i}`, cells[i] ?? ""]))
          : Object.fromEntries(cells.map((v, i) => [`col_${i}`, v]));
      });
    })) as Record<string, string>[];
    udbg("raw payout rows:", rawRows.length);

    if (!rawRows.length) throw new Error("Payout table is empty.");

    const rows: PayoutRow[] = rawRows
      .map((r: Record<string, string>) => ({
        month_year : dateToMonthYear(r["Date"] ?? ""),
        payout_date: r["Date"]  ?? "",
        amount     : r["Total"] ?? "",
        raw_data   : r,
      }))
      .filter((r: PayoutRow) => r.month_year !== "");

    log(`Scraped ${rows.length} payout rows`);

    // ── Earnings page ─────────────────────────────────────────────────────────
    await utimed("wait Earnings link", () =>
      waitInPage(page, hasLinkText, SELECTORS.earningsLinkText, "Earnings link", T.selector)
    );
    await utimed("click Earnings + waitForNavigation", () =>
      Promise.all([
        page.waitForNavigation({ waitUntil: "networkidle2", timeout: T.nav }),
        page.evaluate((text: string) => {
          const link = Array.from(document.querySelectorAll("a"))
            .find((a) => (a as HTMLAnchorElement).textContent?.includes(text)) as HTMLAnchorElement;
          link?.click();
        }, SELECTORS.earningsLinkText),
      ])
    );
    udbg("earnings page url:", page.url());

    await utimed("wait earningsTable", () =>
      waitInPage(page, hasSelector, SELECTORS.payoutTable, "earnings table", T.selector)
    );
    await utimed("settle earnings", () => page.waitForTimeout(T.settle));

    const earningsData = await utimed("evaluate earnings rows", () => page.evaluate(() => {
      const headers = Array.from(document.querySelectorAll("thead th, thead td"))
        .map((th) => th.textContent?.trim() ?? "");
      const allRows = Array.from(document.querySelectorAll("tbody tr")).map((row) => {
        const cells = Array.from(row.querySelectorAll("td"))
          .map((td) => td.textContent?.trim() ?? "");
        return headers.length > 0
          ? Object.fromEntries(headers.map((h, i) => [h || `col_${i}`, cells[i] ?? ""]))
          : Object.fromEntries(cells.map((v, i) => [`col_${i}`, v]));
      });
      const totalRow = allRows.find((r: Record<string, string>) =>
        Object.values(r).some((v) => typeof v === "string" && v.toLowerCase().includes("total income"))
      );
      const totalIncome = totalRow
        ? Object.values(totalRow).find((v, i) => i > 0 && v !== "") ?? ""
        : "";
      return { totalIncome: String(totalIncome), rows: allRows };
    })) as { totalIncome: string; rows: Record<string, string>[] };
    udbg("earnings total income:", earningsData.totalIncome, "rows:", earningsData.rows.length);

    const earnings: EarningsSnapshot = {
      total_income: earningsData.totalIncome,
      raw_data    : earningsData.rows,
    };

    log(`Earnings Total Income = ${earnings.total_income}`);
    return { userId: user.id, ghId: user.gh_id, success: true, rows, earnings };

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(tag, "Scrape failed:", message);
    if (page) {
      try {
        const url      = page.url?.() ?? "unknown";
        const title    = await page.title?.() ?? "unknown";
        const bodyText = await page.evaluate?.(() =>
          (document.body?.innerText ?? "").slice(0, 500)
        ) ?? "";
        console.error(tag, `Page at failure: url=${url} title=${title}`);
        console.error(tag, `Body snippet: ${bodyText}`);
      } catch (_) { /* ignore */ }
    }
    return { userId: user.id, ghId: user.gh_id, success: false, error: message };

  } finally {
    if (browser) {
      try { await browser.disconnect(); } catch (_) { /* ignore */ }
    }
    if (sessionId) {
      try {
        await fetch(`https://api.steel.dev/v1/sessions/${sessionId}/release`, {
          method : "POST",
          headers: { "Steel-Api-Key": STEEL_API_KEY },
        });
      } catch (_) { /* ignore */ }
    }
  }
}

// ── Telegram ──────────────────────────────────────────────────────────────────

// Telegram hard-caps messages at 4096 chars; leave headroom for header/footer/<pre> wrapper.
const TG_CHUNK_LIMIT = 3500;
const NAME_W = 16;
const GHID_W = 9;
const AMT_W  = 11;
const ROW_W  = NAME_W + 1 + GHID_W + 1 + AMT_W; // +1 separator space between each column

interface PayoutTableRow   { name: string; ghId: string; amount: number; }
interface PayoutTableGroup { name: string; rows: PayoutTableRow[]; subtotal: number; }

function parseAmount(val: string | null | undefined): number {
  if (!val) return 0;
  const n = parseFloat(val.replace(/[^\d.,]/g, "").replace(/^\./, "").replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
}

function fmtINR(val: number): string {
  if (val === 0) return "—";
  return "₹" + val.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

// Telegram's HTML parser rejects unescaped <, >, & — swap for lookalikes that keep column widths intact.
function safeName(s: string): string {
  return s.replace(/[<>&]/g, (c) => (c === "<" ? "(" : c === ">" ? ")" : "+"));
}

function padName(s: string): string {
  const t = s.length > NAME_W ? s.slice(0, NAME_W - 1) + "…" : s;
  return t.padEnd(NAME_W);
}

function padAmt(s: string): string {
  return s.padStart(AMT_W);
}

function padGhId(s: string): string {
  const t = s.length > GHID_W ? s.slice(0, GHID_W - 1) + "…" : s;
  return t.padEnd(GHID_W);
}

// Fetch enabled users with their group + this month's payout, grouped like the admin Dashboard table.
async function buildPayoutGroups(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  monthYear: string
): Promise<PayoutTableGroup[]> {
  const { data } = await supabase
    .from("users")
    .select("name, gh_id, order_no, enabled, groups(name), payouts(amount, month_year)")
    .eq("enabled", true)
    .order("order_no", { ascending: true, nullsFirst: false })
    .order("name");

  const map = new Map<string, PayoutTableRow[]>();
  for (const u of (data ?? []) as any[]) {
    const key    = u.groups?.name ?? "";
    const payout = (u.payouts as any[] ?? []).find((p) => p.month_year === monthYear);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push({ name: u.name as string, ghId: u.gh_id as string, amount: parseAmount(payout?.amount) });
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => {
      if (a === "") return 1;
      if (b === "") return -1;
      return a.localeCompare(b);
    })
    .map(([key, rows]) => ({
      name    : key || "Unassigned",
      rows,
      subtotal: rows.reduce((s, r) => s + r.amount, 0),
    }));
}

function renderGroupLines(g: PayoutTableGroup): string[] {
  const rule = "─".repeat(ROW_W);
  return [
    safeName(g.name),
    ...g.rows.map((r) => `  ${padName(safeName(r.name))} ${padGhId(r.ghId)} ${padAmt(fmtINR(r.amount))}`),
    `  ${rule}`,
    `  ${padName(`Subtotal (${g.rows.length})`)} ${padGhId("")} ${padAmt(fmtINR(g.subtotal))}`,
  ];
}

function buildGrandTotalLines(groups: PayoutTableGroup[]): string[] {
  const count = groups.reduce((s, g) => s + g.rows.length, 0);
  const total = groups.reduce((s, g) => s + g.subtotal, 0);
  return [
    "═".repeat(ROW_W),
    `${padName(`GRAND TOTAL (${count})`)} ${padGhId("")} ${padAmt(fmtINR(total))}`,
  ];
}

function buildTableLines(groups: PayoutTableGroup[]): string[] {
  const lines: string[] = [];
  groups.forEach((g, i) => {
    if (i > 0) lines.push("");
    lines.push(...renderGroupLines(g));
  });
  lines.push("");
  lines.push(...buildGrandTotalLines(groups));
  return lines;
}

// Greedily pack lines into chunks that each stay under the char budget (may split mid-group for huge rosters).
function chunkLines(lines: string[], maxChars: number): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let len = 0;
  for (const line of lines) {
    const add = line.length + 1;
    if (current.length && len + add > maxChars) {
      chunks.push(current);
      current = [];
      len = 0;
    }
    current.push(line);
    len += add;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

async function sendTelegramMessage(text: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method : "POST",
      headers: { "Content-Type": "application/json" },
      body   : JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      console.error(`Telegram API rejected message (${res.status}):`, JSON.stringify(body));
      return false;
    }
    return true;
  } catch (err) {
    console.error("Telegram send failed:", err);
    return false;
  }
}

async function sendTelegram(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  success: number,
  fail: number,
  upserted: number,
  monthYear: string
): Promise<boolean> {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error(`Telegram not configured — has_token=${Boolean(TELEGRAM_TOKEN)} has_chat_id=${Boolean(TELEGRAM_CHAT_ID)}`);
    return false;
  }

  const [year, month] = monthYear.split("-");
  const monthName = new Date(Number(year), Number(month) - 1).toLocaleString("en", { month: "long" });
  const now       = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

  const headerText = [
    `🌾 <b>Green Harvest Synced — ${monthName} ${year}</b>`,
    "",
    `✅ Scraped: ${success}   ❌ Failed: ${fail}   📊 Payout rows upserted: ${upserted}`,
  ].join("\n");

  const footerText = [
    `📅 Run at: ${now} IST`,
    ADMIN_PORTAL_URL ? `🔗 <a href="${ADMIN_PORTAL_URL}">Admin Portal</a>` : "",
  ].filter(Boolean).join("\n");

  let groups: PayoutTableGroup[] = [];
  try {
    groups = await buildPayoutGroups(supabase, monthYear);
  } catch (err) {
    console.error("Failed to build payout table for Telegram:", err);
  }

  if (!groups.length) {
    const ok = await sendTelegramMessage([headerText, "", footerText].join("\n"));
    if (ok) console.log("Telegram notification sent (no users to table).");
    return ok;
  }

  const chunks = chunkLines(buildTableLines(groups), TG_CHUNK_LIMIT);

  for (let i = 0; i < chunks.length; i++) {
    const segments: string[] = [];
    segments.push(i === 0 ? headerText : `<i>(continued ${i + 1}/${chunks.length})</i>`);
    segments.push("");
    segments.push(`<pre>${chunks[i].join("\n")}</pre>`);
    if (i === chunks.length - 1) { segments.push(""); segments.push(footerText); }

    const ok = await sendTelegramMessage(segments.join("\n"));
    if (!ok) return false;
  }

  console.log(`Telegram notification sent (${chunks.length} message${chunks.length !== 1 ? "s" : ""}).`);
  return true;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Puppeteer's waitForSelector/waitForFunction take ~14s each over the Steel CDP connection
// even when the element is already present; plain page.evaluate is fast, so poll with it.
async function waitInPage(
  // deno-lint-ignore no-explicit-any
  page: any,
  // deno-lint-ignore no-explicit-any
  fn: (arg: any) => boolean,
  arg: unknown,
  label: string,
  timeout: number
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await page.evaluate(fn, arg).catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Timed out after ${timeout}ms waiting for ${label}`);
}

const hasSelector = (sel: string) => !!document.querySelector(sel);
const hasLinkText = (text: string) => Array.from(document.querySelectorAll("a"))
  .some((a) => (a as HTMLAnchorElement).textContent?.includes(text));

// "DD/MM/YYYY" → "YYYY-MM"
function dateToMonthYear(date: string): string {
  const parts = date.split("/");
  if (parts.length !== 3) return "";
  return `${parts[2]}-${parts[1]}`;
}

function getMonthYear(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "Content-Type"               : "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
