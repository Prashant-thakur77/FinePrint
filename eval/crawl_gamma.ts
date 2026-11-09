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
const MAX_OFFSET = 2000; // Gamma answers 422 beyond this

/** Pages through one end-date window; splits it in half when it holds more than Gamma will page. */
async function crawlWindow(startMs: number, endMs: number): Promise<number> {
  const startIso = new Date(startMs).toISOString(), endIso = new Date(endMs).toISOString();
  const rows: Awaited<ReturnType<typeof gammaMarkets>> = [];
  for (let offset = 0; ; offset += 100) {
    if (offset > MAX_OFFSET - 100) {
      if (endMs - startMs <= 15 * 60_000) break; // 15-minute windows are as fine as it gets
      const mid = startMs + Math.floor((endMs - startMs) / 2);
      return (await crawlWindow(startMs, mid)) + (await crawlWindow(mid, endMs));
    }
    const page = await gammaMarkets({ closed: true, limit: 100, offset, end_date_min: startIso, end_date_max: endIso, order: "id", ascending: true });
    rows.push(...page);
    if (page.length < 100) break;
  }
  // Gamma's end_date_max is inclusive; keep each market in exactly one window.
  const mine = rows.filter((m) => m.endDate && Date.parse(m.endDate) >= startMs && Date.parse(m.endDate) < endMs);
  if (mine.length) appendFileSync(OUT, mine.map((m) => JSON.stringify(m)).join("\n") + "\n");
  disputed += mine.filter((m) => m.uma.includes("disputed")).length;
  return mine.length;
}

async function crawlDay(day: string) {
  const start = Date.parse(`${day}T00:00:00Z`);
  total += await crawlWindow(start, start + 86_400_000);
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
