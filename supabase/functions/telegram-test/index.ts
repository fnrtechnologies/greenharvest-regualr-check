import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// @ts-ignore — npm: imports are resolved by Deno runtime, not the local TS checker
import { createClient } from "npm:@supabase/supabase-js@2";

// ── Diagnostic function: previews the grouped payout table Telegram message ──
// POST /telegram-test            → uses the current month
// POST /telegram-test?month_year=2026-06 → preview a specific month

const TELEGRAM_TOKEN   = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID") ?? "";
const ADMIN_PORTAL_URL = Deno.env.get("ADMIN_PORTAL_URL") ?? "";
const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

// deno-lint-ignore no-explicit-any
async function buildPayoutGroups(supabase: any, monthYear: string): Promise<PayoutTableGroup[]> {
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

async function sendTelegramMessage(text: string): Promise<{ ok: boolean; status: number; body: unknown }> {
  const res  = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method : "POST",
    headers: { "Content-Type": "application/json" },
    body   : JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  const body = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body };
}

function getMonthYear(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

Deno.serve(async (req: Request) => {
  const diag: Record<string, unknown> = {
    has_token  : Boolean(TELEGRAM_TOKEN),
    has_chat_id: Boolean(TELEGRAM_CHAT_ID),
  };

  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
    return new Response(JSON.stringify({ ...diag, error: "Telegram not configured" }, null, 2), {
      status : 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const monthYear = new URL(req.url).searchParams.get("month_year") ?? getMonthYear();
  const [year, month] = monthYear.split("-");
  const monthName = new Date(Number(year), Number(month) - 1).toLocaleString("en", { month: "long" });
  const now       = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

  const headerText = [
    `🌾 <b>Green Harvest Synced — ${monthName} ${year}</b> <i>(test preview)</i>`,
    "",
    `✅ Scraped: 0   ❌ Failed: 0   📊 Payout rows upserted: 0`,
  ].join("\n");

  const footerText = [
    `📅 Run at: ${now} IST`,
    ADMIN_PORTAL_URL ? `🔗 <a href="${ADMIN_PORTAL_URL}">Admin Portal</a>` : "",
  ].filter(Boolean).join("\n");

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const groups   = await buildPayoutGroups(supabase, monthYear);

  const sends: unknown[] = [];

  if (!groups.length) {
    sends.push(await sendTelegramMessage([headerText, "", "(no enabled users found)", "", footerText].join("\n")));
  } else {
    const chunks = chunkLines(buildTableLines(groups), TG_CHUNK_LIMIT);
    for (let i = 0; i < chunks.length; i++) {
      const segments: string[] = [];
      segments.push(i === 0 ? headerText : `<i>(continued ${i + 1}/${chunks.length})</i>`);
      segments.push("");
      segments.push(`<pre>${chunks[i].join("\n")}</pre>`);
      if (i === chunks.length - 1) { segments.push(""); segments.push(footerText); }
      sends.push(await sendTelegramMessage(segments.join("\n")));
    }
  }

  return new Response(JSON.stringify({ ...diag, monthYear, groups: groups.length, sends }, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
});
