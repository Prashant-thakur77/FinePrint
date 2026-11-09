/**
 * Time-machine replay: does the court get better as case law accumulates?
 *
 * Held-out 2026 test markets are processed in time order. Each is ruled at
 * its ruling time (3 days before close, or at creation if later) using only
 * precedents that closed before that moment. Two arms, one change:
 *   static    only the seeded precedents (closed before 2026)
 *   learning  seeded precedents + the outcomes this replay has written so far
 * After ruling the markets of a month, the outcomes of test markets that
 * closed that month are written to Walrus Memory on mainnet (real writes,
 * capped by --writes), so later months can recall them.
 *
 *   npx tsx eval/learning_curve.ts [writes=150]
 */
import "dotenv/config";
import { judge } from "../src/court/judge.js";
import { filterPrecedents, recallPatterns } from "../src/court/ruling.js";
import { recall, rememberBulkAndWait } from "../src/memory/client.js";
import { fields, NS } from "../src/memory/types.js";
import { distil } from "../src/precedents/distil.js";
import { DATA, metrics, readJson, RESULTS, round, writeJson } from "./lib.js";
import type { Row } from "./build_dataset.js";

const maxWrites = Number(process.argv[2] ?? 150);
const STATE = new URL("learning_state.json", DATA);
const test = readJson<Row[]>(new URL("test.json", DATA), []);
const seeded = new Set(readJson<{ kind: string; ref: string; status: string }[]>(new URL("seed_log.json", RESULTS), []).filter((e) => e.kind === "precedent" && e.status === "done").map((e) => e.ref));
const testIds = new Set(test.map((r) => r.id));

const rulingTime = (r: Row) => new Date(Math.max(Date.parse(r.createdAt ?? r.closedTime), Date.parse(r.closedTime) - 3 * 86_400_000)).toISOString();
const month = (iso: string) => iso.slice(0, 7);

interface State { written: { id: string; blobId: string; closed: string; at: string }[]; rows: { id: string; month: string; label: boolean; staticV: string; learnV: string; staticP: number; learnP: number; nStatic: number; nLearn: number; learnedCites: number }[] }
const state = readJson<State>(STATE, { written: [], rows: [] });
const doneRows = new Set(state.rows.map((r) => r.id));
const written = new Set(state.written.map((w) => w.id));

const ordered = [...test].sort((a, b) => rulingTime(a).localeCompare(rulingTime(b)));
const months = [...new Set(ordered.map((r) => month(rulingTime(r))))].sort();

for (const mo of months) {
  const batch = ordered.filter((r) => month(rulingTime(r)) === mo && !doneRows.has(r.id));
  for (const r of batch) {
    const asOf = rulingTime(r);
    const hits = await recall("PRECEDENTS", NS.precedents, `${r.question}\n${r.rules.slice(0, 600)}`, 60);
    const all = filterPrecedents(hits, { asOf, k: 8, excludeMarket: r.id });
    const stat = filterPrecedents(hits.filter((h) => seeded.has(fields(h.text).market)), { asOf, k: 8, excludeMarket: r.id });
    const patterns = await recallPatterns(r.patterns);
    const [js, jl] = await Promise.all([
      judge({ title: r.question, rules: r.rules, level: "patterns", precedents: stat, patterns }),
      judge({ title: r.question, rules: r.rules, level: "patterns", precedents: all, patterns }),
    ]);
    state.rows.push({ id: r.id, month: mo, label: r.disputed, staticV: js.verdict, learnV: jl.verdict, staticP: js.pDispute, learnP: jl.pDispute, nStatic: stat.length, nLearn: all.length, learnedCites: jl.cites.filter((c) => all.find((p) => p.blobId === c && testIds.has(p.market))).length });
    writeJson(STATE, state);
  }
  // Outcomes of test markets that closed this month become case law for the months after.
  const closing = test.filter((r) => month(r.closedTime) === mo && !written.has(r.id));
  for (let i = 0; i < closing.length && state.written.length < maxWrites; i += 10) {
    const chunk = closing.slice(i, Math.min(i + 10, i + maxWrites - state.written.length));
    const items = await Promise.all(chunk.map(async (r) => ({ r, text: (await distil({ id: r.id, question: r.question, rules: r.rules, tokens: r.tokens, closedTime: r.closedTime, outcome: r.outcome, uma: r.uma, disputed: r.disputed })).text })));
    const res = await rememberBulkAndWait("PRECEDENTS", items.map((x) => ({ text: x.text, namespace: NS.precedents })));
    res.forEach((x, j) => { if (x.status === "done") { state.written.push({ id: items[j].r.id, blobId: x.blobId, closed: items[j].r.closedTime, at: new Date().toISOString() }); written.add(items[j].r.id); } });
    writeJson(STATE, state);
  }
  console.log(`${mo}: ruled ${state.rows.filter((r) => r.month === mo).length}, written so far ${state.written.length}`);
  await new Promise((s) => setTimeout(s, 60_000)); // write → recall lag
}

const per = months.map((mo) => {
  const xs = state.rows.filter((r) => r.month === mo);
  const ms = metrics(xs.map((r) => ({ label: r.label, pred: r.staticV === "HIGH", score: r.staticP })));
  const ml = metrics(xs.map((r) => ({ label: r.label, pred: r.learnV === "HIGH", score: r.learnP })));
  return { month: mo, n: xs.length, staticAccuracy: round(ms.accuracy), learningAccuracy: round(ml.accuracy), learnedPrecedentsAvailable: state.written.filter((w) => w.closed < `${mo}-01`).length, rulingsCitingLearned: xs.filter((r) => r.learnedCites > 0).length };
});
const all = (k: "staticV" | "learnV", p: "staticP" | "learnP") => round(metrics(state.rows.map((r) => ({ label: r.label, pred: r[k] === "HIGH", score: r[p] }))).accuracy);
const out = { command: `npx tsx eval/learning_curve.ts ${maxWrites}`, writes: state.written.length, overall: { static: all("staticV", "staticP"), learning: all("learnV", "learnP") }, perMonth: per, writtenBlobs: state.written };
writeJson(new URL("learning_curve.json", RESULTS), out);
console.log(JSON.stringify({ ...out, writtenBlobs: undefined }, null, 2));
