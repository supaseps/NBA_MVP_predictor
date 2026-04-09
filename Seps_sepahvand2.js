/**
 * NBA MVP Voting Scraper - basketball-reference.com
 * Uses Playwright (headless Chromium) to scrape MVP voting data 2010–2024.
 */

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const START_YEAR = 2010;
const END_YEAR   = 2025;
const DELAY_MS   = 3000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function toSeasonLabel(year) {
  return `${year - 1}-${String(year).slice(2)}`;
}

async function scrapeMVPYear(page, year) {
  const url = `https://www.basketball-reference.com/awards/awards_${year}.html`;

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
  } catch (err) {
    process.stderr.write(`[WARN] Failed to load ${year}: ${err.message}\n`);
    return [];
  }

  try {
    await page.waitForSelector("#mvp", { timeout: 10000 });
  } catch {
    process.stderr.write(`[WARN] #mvp table not found for ${year}\n`);
    return [];
  }

  const rows = await page.evaluate((season) => {
    const table = document.querySelector("#mvp");
    if (!table) return [];

    const headerRow = [...table.querySelectorAll("thead tr")].pop();
    const colNames  = [...headerRow.querySelectorAll("th")].map(
      (th) => th.dataset.stat || th.innerText.trim()
    );

    const results = [];

    table.querySelectorAll("tbody tr").forEach((tr) => {
      if (tr.classList.contains("thead")) return;
      const cells = [...tr.querySelectorAll("td, th")];
      if (!cells.length) return;

      const row = { Season: season.label, SeasonYear: season.year };

      cells.forEach((cell, i) => {
        const key = colNames[i];
        if (!key) return;
        let raw = cell.innerText.trim();

        // Strip team/position info e.g. "LeBron James CLE · SF · 27" → "LeBron James"
        if (key === "player") {
          raw = raw.replace(/\s[A-Z]{2,3}\s·.*/, "").trim();
        }

        row[key] = raw === "" ? null : isNaN(raw) ? raw : Number(raw);
      });                              // closes cells.forEach

      if (row["player"]) results.push(row);
    });                                // closes tbody tr forEach

    return results;
  }, { label: toSeasonLabel(year), year });  // <-- this was missing!

  return rows;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/120.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  const allRows = [];

  for (let year = START_YEAR; year <= END_YEAR; year++) {
    process.stderr.write(`Scraping ${toSeasonLabel(year)}...\n`);

    const rows = await scrapeMVPYear(page, year);
    allRows.push(...rows);

    process.stderr.write(`  → ${rows.length} rows\n`);

    if (year < END_YEAR) await sleep(DELAY_MS);
  }

  await browser.close();

  fs.writeFileSync(
    path.join(__dirname, "mvp_data.json"),
    JSON.stringify(allRows)
  );
  process.stdout.write("done");
}

main().catch((err) => {
  process.stderr.write(`[ERROR] ${err.message}\n`);
  process.exit(1);
});