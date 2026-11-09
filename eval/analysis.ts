/**
 * Where memory helps and where it doesn't: ranking quality (AUC of p_dispute),
 * how often each condition says HIGH, accuracy by distance to the nearest
 * recalled precedent, and accuracy per wording pattern. Run 1 of each
 * condition; same test set, same recall cache.
 *
 *   npx tsx eval/analysis.ts
 */
import { DATA, readJson, RESULTS, round, writeJson } from "./lib.js";
import type { Row } from "./build_dataset.js";
import type { Prediction } from "./dispute.js";

const test = new Map(readJson<Row[]>(new URL("test.json", DATA), []).map((r) => [r.id, r]));
const cache = readJson<Record<string, { precedents: { distance: number; disputed: boolean }[] }>>(new URL("recall_cache.json", DATA), {});
const auc = (rows: { label: boolean; p: number }[]) => {
  const pos = rows.filter((r) => r.label).map((r) => r.p), neg = rows.filter((r) => !r.label).map((r) => r.p);
  let s = 0; for (const a of pos) for (const b of neg) s += a > b ? 1 : a === b ? 0.5 : 0;
  return round(s / (pos.length * neg.length));
};
const acc = (xs: Prediction[]) => (xs.length ? round(xs.filter((p) => p.pred === p.label).length / xs.length) : null);
const out: Record<string, unknown> = { command: "npx tsx eval/analysis.ts" };
// Recall signal: share of recalled precedents that were disputed, by test label.
const share = (lab: boolean) => { const xs = [...test.values()].filter((r) => r.disputed === lab && cache[r.id]?.precedents.length).map((r) => cache[r.id].precedents.filter((p) => p.disputed).length / cache[r.id].precedents.length); return round(xs.reduce((a, b) => a + b, 0) / xs.length); };
const nearest = (lab: boolean) => { const xs = [...test.values()].filter((r) => r.disputed === lab && cache[r.id]?.precedents.length).map((r) => (cache[r.id].precedents[0].disputed ? 1 : 0)); return round(xs.reduce((a: number, b) => a + b, 0) / xs.length); };
out.recallSignal = { disputedTestMarkets: { recalledDisputedShare: share(true), nearestDisputed: nearest(true) }, cleanTestMarkets: { recalledDisputedShare: share(false), nearestDisputed: nearest(false) } };
for (const level of ["rules", "precedents", "patterns"]) {
  const runs = readJson<Prediction[][]>(new URL(`dispute_${level}_predictions.json`, DATA), []);
  if (!runs.length) continue;
  const r = runs[0].filter((p) => p.verdict !== "ERR");
  const byDist = [[0, 0.3], [0.3, 0.45], [0.45, 9]].map(([lo, hi]) => { const g = r.filter((p) => { const d = cache[p.id]?.precedents[0]?.distance; return d != null && d >= lo && d < hi; }); return { nearestDistance: `${lo}-${hi === 9 ? "max" : hi}`, n: g.length, accuracy: acc(g), disputed: g.filter((p) => p.label).length }; });
  const tags = ["deadline+confirmation-lag", "consensus-of-reporting", "official-source-only", "announcement-vs-action", "appearance/subjective", "date-in-title-timezone", "sports-postponement"];
  const byPattern = tags.map((t) => { const g = r.filter((p) => test.get(p.id)?.patterns.includes(t)); return { pattern: t, n: g.length, accuracy: acc(g), disputed: g.filter((p) => p.label).length, highShare: g.length ? round(g.filter((p) => p.pred).length / g.length) : null }; }).filter((x) => x.n >= 5);
  out[level] = { auc: auc(r.map((p) => ({ label: p.label, p: p.p }))), highShare: round(r.filter((p) => p.pred).length / r.length), byNearestDistance: byDist, byPattern };
}
writeJson(new URL("analysis.json", RESULTS), out);
console.log(JSON.stringify(out, null, 1).slice(0, 1500));
