/**
 * Builds the eval dataset from eval/data/markets.jsonl (see crawl_gamma.ts).
 *
 *  - keeps resolved binary markets settled through Polymarket's UMA adapters
 *  - label: disputed = UMA status sequence contains "disputed"
 *    (source "gamma:umaResolutionStatuses"; on-chain DisputePrice labels are
 *    merged in by label_onchain.ts when available and recorded per market)
 *  - precedent pool: closed before 2026-01-01
 *  - test: closed 2026-01-01 .. 2026-10-31, balanced disputed / not disputed,
 *    non-disputed sampled to match the disputed set's category mix (seed 7)
 *  - precedents to seed: every disputed pool market (capped) plus matched
 *    non-disputed ones, plus the MSTR 2025 twin (market 516926)
 *
 *   npx tsx eval/build_dataset.ts [testPerClass=150] [precedents=400]
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { categoryOf, outcomeOf, type MarketRecord } from "../src/polymarket/gamma.js";
import { PATTERNS } from "../src/patterns/patterns.js";
import { tagMarket } from "../src/patterns/patterns.js";
import { DATA, readJson, readJsonl, RESULTS, rng, shuffle, writeJson } from "./lib.js";

const perClass = Number(process.argv[2] ?? 150);
const nPrecedents = Number(process.argv[3] ?? 400);
const ADAPTERS = new Set(["0x65070be91477460d8a7aeeb94ef92fe056c2f2a7", "0x6a9d222616c90fca5754cd1333cfd9b7fb6a4f74", "0x2f5e3684cb1f318ec51b00edba38d79ac2c0aa9d", "0x157ce2d672854c848c9b79c49a8cc6cc89176a49", "0xb21182d0494521cf45dbbeebb5a3acaab6d22093", "0x69c47de9d4d3dad79590d61b9e05918e03775f24"]);
const TWIN = "516926";
const DEMO = "2169995";

export interface Row {
  id: string; question: string; rules: string; conditionId: string; questionId: string; tokens: string[];
  createdAt: string | null; closedTime: string; category: string; patterns: string[];
  outcome: string; uma: string[]; disputed: boolean; labelSource: string; volume: number;
}

// Stream the crawl (it is millions of lines): dedupe by id, keep every disputed
// market, keep a seeded reservoir of clean ones per stratum, and count pattern
// evidence over the whole pool on the way.
const POOL_END = "2026-01-01", TEST_START = "2026-01-01", TEST_END = "2026-11-01";
const onchain = readJson<Record<string, boolean>>(new URL("onchain_disputes.json", DATA), {});
const seenIds = new Set<string>();
const drop: Record<string, number> = {};
const skip = (why: string) => { drop[why] = (drop[why] ?? 0) + 1; };
let crawled = 0, kept = 0, keptDisputed = 0;
const poolCount = { total: 0, disputed: 0 }, windowCount = { total: 0, disputed: 0 };
const evidence = new Map<string, { disputed: number; total: number }>();
const poolDisputedRows: Row[] = [], windowDisputedRows: Row[] = [];
const RES_CAP = 400;
const reservoirs = new Map<string, { seen: number; rows: Row[] }>();
const resRand = rng(3);
function reservoir(key: string, r: Row) {
  const b = reservoirs.get(key) ?? { seen: 0, rows: [] };
  b.seen++;
  if (b.rows.length < RES_CAP) b.rows.push(r);
  else { const j = Math.floor(resRand() * b.seen); if (j < RES_CAP) b.rows[j] = r; }
  reservoirs.set(key, b);
}
const keepTwinDemo: Row[] = [];

const rl = createInterface({ input: createReadStream(new URL("markets.jsonl", DATA)), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line) continue;
  const idEnd = line.indexOf('"', 7);
  const id = line.slice(7, idEnd);
  if (seenIds.has(id)) continue;
  seenIds.add(id);
  crawled++;
  const m = JSON.parse(line) as MarketRecord;
  if (m.outcomes.length !== 2) { skip("not binary"); continue; }
  if (!m.closedTime) { skip("no close time"); continue; }
  const outcome = outcomeOf(m);
  if (!outcome) { skip("no clear outcome"); continue; }
  if (!ADAPTERS.has(m.resolvedBy.toLowerCase())) { skip("not resolved by a UMA adapter"); continue; }
  if (!m.uma.length) { skip("no UMA status history"); continue; }
  if (!m.description || m.description.length < 40) { skip("no rules text"); continue; }
  const chain = m.questionId ? onchain[m.questionId.toLowerCase()] : undefined;
  const r: Row = {
    id: m.id, question: m.question, rules: m.description, conditionId: m.conditionId, questionId: m.questionId, tokens: m.tokens,
    createdAt: m.createdAt, closedTime: m.closedTime, category: categoryOf(m), patterns: tagMarket(m.question, m.description),
    outcome, uma: m.uma, disputed: chain ?? m.uma.includes("disputed"), labelSource: chain === undefined ? "gamma:umaResolutionStatuses" : "polygon:DisputePrice", volume: m.volume,
  };
  kept++; if (r.disputed) keptDisputed++;
  if (r.id === TWIN || r.id === DEMO) keepTwinDemo.push(r);
  if (r.closedTime < POOL_END) {
    poolCount.total++; if (r.disputed) poolCount.disputed++;
    for (const t of r.patterns) { const e = evidence.get(t) ?? { disputed: 0, total: 0 }; e.total++; if (r.disputed) e.disputed++; evidence.set(t, e); }
    if (r.disputed) poolDisputedRows.push(r); else reservoir(`pool|${r.category}|${r.patterns.slice().sort().join("+")}`, r);
  } else if (r.closedTime >= TEST_START && r.closedTime < TEST_END) {
    windowCount.total++; if (r.disputed) windowCount.disputed++;
    if (r.disputed) windowDisputedRows.push(r); else reservoir(`win|${r.category}`, r);
  }
  if (crawled % 200_000 === 0) console.error(`streamed ${crawled}`);
}
const pool = [...poolDisputedRows, ...[...reservoirs].filter(([k]) => k.startsWith("pool|")).flatMap(([, b]) => b.rows)];
const window = [...windowDisputedRows, ...[...reservoirs].filter(([k]) => k.startsWith("win|")).flatMap(([, b]) => b.rows)];
const rows = [...pool, ...window, ...keepTwinDemo.filter((r) => !pool.includes(r) && !window.includes(r))];

// Balanced, category-stratified test set.
const rand = rng(7);
const disputedW = shuffle(window.filter((r) => r.disputed), rand);
const cleanW = shuffle(window.filter((r) => !r.disputed), rand);
const testDisputed = disputedW.slice(0, perClass);
const want = new Map<string, number>();
for (const r of testDisputed) want.set(r.category, (want.get(r.category) ?? 0) + 1);
const testClean: Row[] = [];
const used = new Set<string>();
for (const [cat, n] of want) for (const r of cleanW.filter((x) => x.category === cat).slice(0, n)) { testClean.push(r); used.add(r.id); }
for (const r of cleanW) { if (testClean.length >= testDisputed.length) break; if (!used.has(r.id)) { testClean.push(r); used.add(r.id); } }
const test = shuffle([...testDisputed, ...testClean], rand);

// Precedents: disputed pool markets first, then the closest non-disputed matches by pattern + category.
const poolDisputed = shuffle(pool.filter((r) => r.disputed), rng(11));
const poolClean = shuffle(pool.filter((r) => !r.disputed), rng(13));
const halfD = Math.min(poolDisputed.length, Math.ceil(nPrecedents / 2));
const precedents: Row[] = poolDisputed.slice(0, halfD);
const sig = (r: Row) => `${r.category}|${r.patterns.slice().sort().join("+")}`;
const needSig = new Map<string, number>();
for (const r of precedents) needSig.set(sig(r), (needSig.get(sig(r)) ?? 0) + 1);
const picked = new Set(precedents.map((r) => r.id));
for (const r of poolClean) {
  if (precedents.length >= nPrecedents) break;
  const k = sig(r);
  if ((needSig.get(k) ?? 0) > 0) { precedents.push(r); picked.add(r.id); needSig.set(k, needSig.get(k)! - 1); }
}
for (const r of poolClean) { if (precedents.length >= nPrecedents) break; if (!picked.has(r.id)) { precedents.push(r); picked.add(r.id); } }
const twin = rows.find((r) => r.id === TWIN);
if (twin && !picked.has(TWIN)) precedents.unshift(twin);

const demo = rows.find((r) => r.id === DEMO);
const count = (xs: Row[]) => ({ total: xs.length, disputed: xs.filter((r) => r.disputed).length });
const catMix = (xs: Row[]) => Object.fromEntries([...xs.reduce((m, r) => m.set(r.category, (m.get(r.category) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]));

const poolBase = poolCount.total ? poolCount.disputed / poolCount.total : 0;
writeJson(new URL("pattern_evidence.json", DATA), { poolSize: poolCount.total, poolDisputed: poolCount.disputed, baseRate: poolBase, patterns: PATTERNS.map((p) => { const e = evidence.get(p.tag) ?? { disputed: 0, total: 0 }; return { tag: p.tag, rule: p.rule, ...e, rate: e.total ? e.disputed / e.total : 0 }; }) });
writeJson(new URL("test.json", DATA), test);
writeJson(new URL("precedents.json", DATA), precedents);
const summary = {
  command: "npx tsx eval/build_dataset.ts " + process.argv.slice(2).join(" "),
  crawledUnique: crawled, kept, dropped: drop,
  disputeRateAll: { total: kept, disputed: keptDisputed },
  pool: { ...poolCount, closedBefore: POOL_END },
  testWindow: { ...windowCount, from: TEST_START, to: TEST_END },
  sampling: "all disputed markets kept; clean markets reservoir-sampled (400 per stratum, seed 3) before selection",
  test: { ...count(test), categories: catMix(test) },
  precedents: { ...count(precedents), categories: catMix(precedents), includesTwin: picked.has(TWIN) || Boolean(twin) },
  labelSources: test.reduce((m, r) => ({ ...m, [r.labelSource]: (m[r.labelSource] ?? 0) + 1 }), {} as Record<string, number>),
  demoInTest: test.some((r) => r.id === DEMO), demoFound: Boolean(demo), twinFound: Boolean(twin),
};
writeJson(new URL("dataset_summary.json", RESULTS), summary);
console.log(JSON.stringify(summary, null, 2));
