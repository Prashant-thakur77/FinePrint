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
import { categoryOf, outcomeOf, type MarketRecord } from "../src/polymarket/gamma.js";
import { tagMarket } from "../src/patterns/patterns.js";
import { DATA, readJson, readJsonl, RESULTS, rng, shuffle, writeJson } from "./lib.js";

const perClass = Number(process.argv[2] ?? 150);
const nPrecedents = Number(process.argv[3] ?? 400);
const ADAPTERS = new Set(["0x65070be91477460d8a7aeeb94ef92fe056c2f2a7", "0x6a9d222616c90fca5754cd1333cfd9b7fb6a4f74", "0x2f5e3684cb1f318ec51b00edba38d79ac2c0aa9d", "0x157ce2d672854c848c9b79c49a8cc6cc89176a49", "0xb21182d0494521cf45dbbeebb5a3acaab6d22093"]);
const TWIN = "516926";
const DEMO = "2169995";

export interface Row {
  id: string; question: string; rules: string; conditionId: string; questionId: string; tokens: string[];
  createdAt: string | null; closedTime: string; category: string; patterns: string[];
  outcome: string; uma: string[]; disputed: boolean; labelSource: string; volume: number;
}

const byId = new Map<string, MarketRecord>();
for (const m of readJsonl<MarketRecord>(new URL("markets.jsonl", DATA))) byId.set(m.id, m);
const onchain = readJson<Record<string, boolean>>(new URL("onchain_disputes.json", DATA), {});

const rows: Row[] = [];
const drop: Record<string, number> = {};
const skip = (why: string) => { drop[why] = (drop[why] ?? 0) + 1; };
for (const m of byId.values()) {
  if (m.outcomes.length !== 2) { skip("not binary"); continue; }
  if (!m.closedTime) { skip("no close time"); continue; }
  const outcome = outcomeOf(m);
  if (!outcome) { skip("no clear outcome"); continue; }
  if (!ADAPTERS.has(m.resolvedBy.toLowerCase())) { skip("not resolved by a UMA adapter"); continue; }
  if (!m.uma.length) { skip("no UMA status history"); continue; }
  if (!m.description || m.description.length < 40) { skip("no rules text"); continue; }
  const chain = m.questionId ? onchain[m.questionId.toLowerCase()] : undefined;
  rows.push({
    id: m.id, question: m.question, rules: m.description, conditionId: m.conditionId, questionId: m.questionId, tokens: m.tokens,
    createdAt: m.createdAt, closedTime: m.closedTime, category: categoryOf(m), patterns: tagMarket(m.question, m.description),
    outcome, uma: m.uma, disputed: chain ?? m.uma.includes("disputed"), labelSource: chain === undefined ? "gamma:umaResolutionStatuses" : "polygon:DisputePrice", volume: m.volume,
  });
}

const POOL_END = "2026-01-01", TEST_START = "2026-01-01", TEST_END = "2026-11-01";
const pool = rows.filter((r) => r.closedTime < POOL_END);
const window = rows.filter((r) => r.closedTime >= TEST_START && r.closedTime < TEST_END);

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

writeJson(new URL("pool.json", DATA), pool);
writeJson(new URL("test.json", DATA), test);
writeJson(new URL("precedents.json", DATA), precedents);
const summary = {
  command: "npx tsx eval/build_dataset.ts " + process.argv.slice(2).join(" "),
  crawled: byId.size, kept: rows.length, dropped: drop,
  disputeRateAll: count(rows),
  pool: { ...count(pool), closedBefore: POOL_END },
  testWindow: { ...count(window), from: TEST_START, to: TEST_END },
  test: { ...count(test), categories: catMix(test) },
  precedents: { ...count(precedents), categories: catMix(precedents), includesTwin: picked.has(TWIN) || Boolean(twin) },
  labelSources: test.reduce((m, r) => ({ ...m, [r.labelSource]: (m[r.labelSource] ?? 0) + 1 }), {} as Record<string, number>),
  demoInTest: test.some((r) => r.id === DEMO), demoFound: Boolean(demo), twinFound: Boolean(twin),
};
writeJson(new URL("dataset_summary.json", RESULTS), summary);
console.log(JSON.stringify(summary, null, 2));
