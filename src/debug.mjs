import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FAILURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "_failures");

/**
 * On a scrape failure, dumps a screenshot, the DOM and the error for debugging.
 * The workflow uploads data/_failures/ as an artifact. Returns the directory written to.
 */
export async function captureFailure(page, { ghId, step, err }) {
  const dir = path.join(FAILURES_DIR, ghId, new Date().toISOString().replace(/[:.]/g, "-"));
  fs.mkdirSync(dir, { recursive: true });

  await page.screenshot({ path: path.join(dir, "screenshot.png"), fullPage: true }).catch(() => {});
  const html = await page.content().catch(() => null);
  if (html) fs.writeFileSync(path.join(dir, "dom.html"), html);
  fs.writeFileSync(
    path.join(dir, "error.txt"),
    `step: ${step}\nurl: ${page.url()}\n\n${err?.stack || err?.message || String(err)}`
  );
  return dir;
}
