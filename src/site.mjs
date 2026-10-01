import { chromium } from "playwright";

export const SITE_URL = process.env.PAYOUT_SITE_URL || "https://greenharvest.live";

const TIMEOUT = 30_000;

export async function launchBrowser({ headless }) {
  return chromium.launch({ headless });
}

export async function newPage(browser) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  context.setDefaultTimeout(TIMEOUT);
  context.setDefaultNavigationTimeout(TIMEOUT);
  return context.newPage();
}

export async function login(page, { username, password }) {
  await page.goto(`${SITE_URL}/login.html`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="userid"]', username);
  await page.fill('input[name="password"]', password);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.endsWith("/login.html")),
    page.click('button[type="submit"]'),
  ]);
  if (await page.locator('input[name="userid"]').count()) {
    throw new Error("Login failed - still on login page");
  }
}

/** Opens a members page and returns every table row as { header: cell }. */
async function openTablePage(page, pagePath) {
  await page.goto(`${SITE_URL}/members/${pagePath}`, { waitUntil: "domcontentloaded" });
  await page.locator("table").first().waitFor();
  await page.waitForLoadState("networkidle").catch(() => {});
  return page.evaluate(() => {
    const headers = Array.from(document.querySelectorAll("thead th, thead td"))
      .map((th) => th.textContent?.trim() ?? "");
    return Array.from(document.querySelectorAll("tbody tr")).map((row) => {
      const cells = Array.from(row.querySelectorAll("td")).map((td) => td.textContent?.trim() ?? "");
      return headers.length > 0
        ? Object.fromEntries(headers.map((h, i) => [h || `col_${i}`, cells[i] ?? ""]))
        : Object.fromEntries(cells.map((v, i) => [`col_${i}`, v]));
    });
  });
}

// "DD/MM/YYYY" -> "YYYY-MM"
function dateToMonthYear(date) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(date.trim());
  return m ? `${m[3]}-${m[2].padStart(2, "0")}` : "";
}

export async function scrapePayouts(page) {
  const rows = await openTablePage(page, "payouts.php");
  if (rows.length === 0) throw new Error("Payout table is empty");
  return rows
    .map((r) => ({
      month_year: dateToMonthYear(r["Date"] ?? ""),
      payout_date: r["Date"] ?? "",
      amount: r["Total"] ?? "",
      raw_data: r,
    }))
    .filter((r) => r.month_year !== "");
}

export async function scrapeEarnings(page) {
  const rows = await openTablePage(page, "incomestatus.php");
  const totalRow = rows.find((r) =>
    Object.values(r).some((v) => v.toLowerCase().includes("total income"))
  );
  const totalIncome = totalRow ? Object.values(totalRow).find((v, i) => i > 0 && v !== "") ?? "" : "";
  return { total_income: totalIncome, raw_data: rows };
}
