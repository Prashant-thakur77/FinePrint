/**
 * Crawls closed Polymarket markets from Gamma, one end-date day at a time,
 * and appends compact records to eval/data/markets.jsonl. Resumable: days
 * already crawled are listed in eval/data/crawl_done.txt.
 *
 *   npx tsx eval/crawl_gamma.ts 2024-01-01 2026-11-01 [concurrency=6]
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { gammaMarkets } from "../src/polymarket/gamma.js";

const [from = "2024-01-01", to = "2026-11-01", conc = "6"] = process.argv.slice(2);
const DIR = new URL("./data/", import.meta.url);
mkdirSync(DIR, { recursive: true });
const OUT = new URL("markets.jsonl", DIR), DONE = new URL("crawl_done.txt", DIR);
const done = new Set(existsSync(DONE) ? readFileSync(DONE, "utf8").split("\n").filter(Boolean) : []);

const days: string[] = [];
for (let d = new Date(from); d < new Date(to); d.setUTCDate(d.getUTCDate() + 1)) days.push(d.toISOString().slice(0, 10));
const todo = days.filter((d) => !done.has(d));
console.log(`${todo.length} of ${days.length} days to crawl`);

let total = 0, disputed = 0, finished = 0;
async function crawlDay(day: string) {
  const next = new Date(Date.parse(day) + 86400_000).toISOString().slice(0, 10);
  let offset = 0, n = 0;
  for (;;) {
    const page = await gammaMarkets({ closed: true, limit: 100, offset, end_date_min: `${day}T00:00:00Z`, end_date_max: `${next}T00:00:00Z`, order: "id", ascending: true });
    // Gamma's end_date_max is inclusive; keep each market in exactly one day.
    const mine = page.filter((m) => m.endDate && m.endDate.slice(0, 10) === day);
    if (mine.length) appendFileSync(OUT, mine.map((m) => JSON.stringify(m)).join("\n") + "\n");
    n += mine.length; disputed += mine.filter((m) => m.uma.includes("disputed")).length;
    if (page.length < 100) break;
    offset += 100;
  }
  total += n;
  appendFileSync(DONE, day + "\n");
  if (++finished % 20 === 0) console.log(`${finished}/${todo.length} days, ${total} markets, ${disputed} disputed`);
}

const queue = [...todo];
await Promise.all(Array.from({ length: Number(conc) }, async () => {
  for (let d = queue.shift(); d; d = queue.shift()) {
    try { await crawlDay(d); } catch (err) { console.error(`day ${d} failed: ${(err as Error).message}`); }
  }
}));
console.log(`done: ${total} markets, ${disputed} disputed`);
