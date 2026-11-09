/**
 * Lead time. For each disputed test market with a price cliff (a fall of at
 * least 30c within 10 minutes), when did Fine Print first have a usable HIGH
 * flag? The bot asks for a ruling at its buy signal (the first spike), so the
 * flag time is the spike, and the lead time is spike → cliff. Also reports how
 * long the cliff itself took: an alert raised at the start of the cliff could
 * not have been acted on in time (the negative result).
 *
 *   npx tsx eval/lead_time.ts
 */
import { DATA, readJson, RESULTS, round, writeJson } from "./lib.js";
import { cliff, firstSpike, historyOf } from "./history.js";
import type { Row } from "./build_dataset.js";
import type { Prediction } from "./dispute.js";

const test = readJson<Row[]>(new URL("test.json", DATA), []);
const predsC = readJson<Prediction[][]>(new URL("dispute_patterns_predictions.json", DATA), [])[0] ?? [];
const rows: { id: string; question: string; verdict?: string; flagAt: string; flagPrice: number; cliffStart: string; cliffMinutes: number; cliffFrom: number; cliffTo: number; leadHours: number }[] = [];
for (const r of test.filter((x) => x.disputed)) {
  const pts = await historyOf(r);
  const c = cliff(pts);
  const s = firstSpike(pts);
  if (!c || !s || s.t >= c.start) continue;
  rows.push({
    id: r.id, question: r.question, verdict: predsC.find((p) => p.id === r.id)?.verdict, flagAt: new Date(s.t * 1000).toISOString(), flagPrice: s.p,
    cliffStart: new Date(c.start * 1000).toISOString(), cliffMinutes: round((c.end - c.start) / 60, 1), cliffFrom: c.from, cliffTo: c.to, leadHours: round((c.start - s.t) / 3600, 2),
  });
}
const flagged = rows.filter((r) => r.verdict === "HIGH");
const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const out = {
  command: "npx tsx eval/lead_time.ts",
  disputedWithSpikeThenCliff: rows.length, flaggedHigh: flagged.length,
  medianLeadHoursWhenFlagged: med(flagged.map((r) => r.leadHours)), medianFlagPrice: med(flagged.map((r) => r.flagPrice)),
  medianCliffMinutes: med(rows.map((r) => r.cliffMinutes)),
  rows,
};
writeJson(new URL("lead_time.json", RESULTS), out);
console.log(JSON.stringify({ ...out, rows: undefined }, null, 2));
