import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

const botToken = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
const adminPortalUrl = process.env.ADMIN_PORTAL_URL;

export const telegramEnabled = Boolean(botToken && chatId);

export async function notify(text) {
  if (!telegramEnabled) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    if (!res.ok) console.error(`Telegram sendMessage failed: ${res.status} ${await res.text()}`);
    return res.ok;
  } catch (err) {
    console.error(`Telegram sendMessage errored: ${err.message}`);
    return false;
  }
}

// Screenshots only live on the ephemeral CI runner, so ship the image itself.
export async function notifyPhoto(filePath, caption) {
  if (!telegramEnabled) return;
  try {
    const form = new FormData();
    form.append("chat_id", chatId);
    form.append("caption", caption.slice(0, 1024));
    form.append("parse_mode", "HTML");
    form.append("photo", new Blob([fs.readFileSync(filePath)], { type: "image/png" }), path.basename(filePath));
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, { method: "POST", body: form });
    if (!res.ok) console.error(`Telegram sendPhoto failed: ${res.status} ${await res.text()}`);
  } catch (err) {
    console.error(`Telegram sendPhoto errored: ${err.message}`);
  }
}

// ── Monthly summary table ─────────────────────────────────────────────────────

// Telegram hard-caps messages at 4096 chars; leave headroom for header/footer/<pre> wrapper.
const CHUNK_LIMIT = 3500;
const NAME_W = 16;
const GHID_W = 9;
const AMT_W = 11;
const ROW_W = NAME_W + 1 + GHID_W + 1 + AMT_W;

function parseAmount(val) {
  if (!val) return 0;
  const n = parseFloat(String(val).replace(/[^\d.,]/g, "").replace(/^\./, "").replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
}

const fmtINR = (v) => (v === 0 ? "—" : "₹" + v.toLocaleString("en-IN", { maximumFractionDigits: 2 }));
// Telegram's HTML parser rejects unescaped <, >, & — swap for lookalikes that keep column widths.
const safe = (s) => s.replace(/[<>&]/g, (c) => (c === "<" ? "(" : c === ">" ? ")" : "+"));
const fit = (s, w) => (s.length > w ? s.slice(0, w - 1) + "…" : s);
const padName = (s) => fit(s, NAME_W).padEnd(NAME_W);
const padGhId = (s) => fit(s, GHID_W).padEnd(GHID_W);
const padAmt = (s) => s.padStart(AMT_W);

function buildTableLines(users, monthYear) {
  const groups = new Map();
  for (const u of users) {
    const key = u.groups?.name ?? "";
    const payout = (u.payouts ?? []).find((p) => p.month_year === monthYear);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ name: u.name, ghId: u.gh_id, amount: parseAmount(payout?.amount) });
  }
  const sorted = [...groups.entries()].sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));

  const lines = [];
  let count = 0;
  let total = 0;
  sorted.forEach(([name, rows], i) => {
    const subtotal = rows.reduce((s, r) => s + r.amount, 0);
    count += rows.length;
    total += subtotal;
    if (i > 0) lines.push("");
    lines.push(
      safe(name || "Unassigned"),
      ...rows.map((r) => `  ${padName(safe(r.name))} ${padGhId(r.ghId)} ${padAmt(fmtINR(r.amount))}`),
      `  ${"─".repeat(ROW_W)}`,
      `  ${padName(`Subtotal (${rows.length})`)} ${padGhId("")} ${padAmt(fmtINR(subtotal))}`
    );
  });
  lines.push("", "═".repeat(ROW_W), `${padName(`GRAND TOTAL (${count})`)} ${padGhId("")} ${padAmt(fmtINR(total))}`);
  return lines;
}

function chunkLines(lines) {
  const chunks = [];
  let current = [];
  let len = 0;
  for (const line of lines) {
    if (current.length && len + line.length + 1 > CHUNK_LIMIT) {
      chunks.push(current);
      current = [];
      len = 0;
    }
    current.push(line);
    len += line.length + 1;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

export async function sendSummary({ users, monthYear, done, failed, failures }) {
  if (!telegramEnabled) {
    console.error("Telegram not configured - skipping summary");
    return false;
  }
  const [year, month] = monthYear.split("-");
  const monthName = new Date(Number(year), Number(month) - 1).toLocaleString("en", { month: "long" });
  const now = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

  const header = [
    `🌾 <b>Green Harvest Synced — ${monthName} ${year}</b>`,
    "",
    `✅ Scraped: ${done}   ❌ Failed: ${failed}`,
    ...failures.map((f) => `  • ${safe(f.name)} (${f.ghId}): ${safe(f.error).slice(0, 120)}`),
  ].join("\n");
  const footer = [`📅 Run at: ${now} IST`, adminPortalUrl ? `🔗 <a href="${adminPortalUrl}">Admin Portal</a>` : ""]
    .filter(Boolean)
    .join("\n");

  const chunks = chunkLines(buildTableLines(users, monthYear));
  for (let i = 0; i < chunks.length; i++) {
    const parts = [i === 0 ? header : `<i>(continued ${i + 1}/${chunks.length})</i>`, "", `<pre>${chunks[i].join("\n")}</pre>`];
    if (i === chunks.length - 1) parts.push("", footer);
    if (!(await notify(parts.join("\n")))) return false;
  }
  return true;
}
