/**
 * Dunks & Threes EPM Scraper
 * Collects rows incrementally while scrolling to handle virtual DOM rendering.
 */

const { chromium } = require("playwright");
const fs            = require("fs");
const path          = require("path");

// ── Credentials ───────────────────────────────────────────────────────────────
const USERNAME = "ssepahva@ualberta.ca";
const PASSWORD = "WrWfNu$1739";

// ── Config ────────────────────────────────────────────────────────────────────
const START_YEAR = 2011;
const END_YEAR   = 2026;
const DELAY_MS   = 4000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Login ─────────────────────────────────────────────────────────────────────
async function login(page) {
  process.stderr.write("Logging in...\n");

  await page.goto("https://dunksandthrees.com/login", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await sleep(2000);

  await page.fill("input[type='email']", USERNAME);
  await page.fill("input[type='password']", PASSWORD);
  await page.click("button[type='submit']");
  await sleep(3000);

  if (page.url().includes("login")) {
    throw new Error("Login failed — check your username and password.");
  }
  process.stderr.write("Login successful!\n");
}

// ── Scroll and collect all rows incrementally ─────────────────────────────────
async function scrollAndCollect(page, seasonLabel) {
  // Get headers once
  const headers = await page.evaluate(() => {
    const table     = document.querySelector("table.main, table.sticky1");
    if (!table) return [];
    const headerRow = table.querySelector("thead tr.header-row");
    if (!headerRow) return [];
    return [...headerRow.querySelectorAll("th")].map((th) =>
      th.innerText.trim().replace(/\s+/g, " ")
    ).filter(Boolean);
  });

  if (!headers.length) {
    process.stderr.write(`[WARN] No headers found for ${seasonLabel}\n`);
    return [];
  }

  const collected = new Map(); // keyed by player name to avoid duplicates
  let stableRounds = 0;
  let lastSize     = 0;

  while (stableRounds < 3) {
    // Extract currently visible rows
    const visibleRows = await page.evaluate((params) => {
      const { headers, season } = params;
      const results = [];
      const table   = document.querySelector("table.main, table.sticky1");
      if (!table) return results;

      table.querySelectorAll("tbody tr").forEach((row) => {
        const cells = [...row.querySelectorAll("td")];
        if (!cells.length) return;

        const rowData = { Season: season };

        cells.forEach((cell, i) => {
          const key = headers[i] || `col_${i}`;
          let raw   = cell.innerText.trim();

          raw = raw.replace(/\s\d+$/, "").trim(); // strip percentile numbers

          if (key === "Player") {
            raw = raw.replace(/\s[A-Z]{2,3}\s·.*$/, "").trim(); // strip team/pos/age
          }

          rowData[key] = raw === "" ? null : isNaN(raw) ? raw : Number(raw);
        });

        if (cells.length > 2) results.push(rowData);
      });

      return results;
    }, { headers, season: seasonLabel });

    // Add to map keyed by player name (deduplicates across scroll positions)
    visibleRows.forEach((row) => {
      const key = row["Player"] || JSON.stringify(row);
      collected.set(key, row);
    });

    process.stderr.write(`    Collected: ${collected.size} unique players\n`);

    // Scroll down
    await page.evaluate(() => {
      const scroller = document.querySelector(".table-wrap");
      if (scroller) scroller.scrollTop += 1500;
    });
    await sleep(600);

    if (collected.size === lastSize) {
      stableRounds++;
    } else {
      stableRounds = 0;
      lastSize     = collected.size;
    }
  }

  return [...collected.values()];
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/120.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });

  await login(page);

  const allRows = [];

  for (let year = START_YEAR; year <= END_YEAR; year++) {
    const seasonLabel = year - 1; // 2011 → 2010, 2026 → 2025
    const url         = `https://dunksandthrees.com/epm/actual?season=${year}`;

    process.stderr.write(`Scraping ${seasonLabel}...\n`);

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

    try {
      await page.waitForSelector("table.main tbody tr, table.sticky1 tbody tr", {
        timeout: 10000,
      });
    } catch {
      process.stderr.write(`[WARN] Table not found for ${seasonLabel}\n`);
      continue;
    }

    await sleep(DELAY_MS);

    const rows = await scrollAndCollect(page, seasonLabel);
    process.stderr.write(`  → ${rows.length} total rows for ${seasonLabel}\n`);
    allRows.push(...rows);
  }

  await browser.close();

  const outPath = path.join(__dirname, "epm_data.json");
  fs.writeFileSync(outPath, JSON.stringify(allRows));
  process.stderr.write(`\nDone! Saved ${allRows.length} total rows to ${outPath}\n`);
  process.stdout.write("done");
}

main().catch((err) => {
  process.stderr.write(`[ERROR] ${err.message}\n`);
  process.exit(1);
});