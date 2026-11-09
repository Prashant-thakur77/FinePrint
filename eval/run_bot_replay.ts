/**
 * Bot replay PnL on the held-out 2026 test set with real CLOB history.
 * Strategy: on the first YES spike (+15c within an hour, landing at 50–95c)
 * buy $100 of YES at the spike price and hold to resolution.
 *   bot alone      every spike is bought
 *   gated (a)      skip when the rule-text-only ruling is HIGH
 *   gated (c)      skip when Fine Print's ruling (precedents + patterns) is HIGH
 * Gated bots pay 0.02 USDC per ruling. Rulings come from the first run of the
 * dispute eval (eval/dispute.ts), so they use the same leakage guard.
 * Results are shown on the balanced test mix and reweighted to the base
 * dispute rate of the 2026 window, because the balanced set over-represents
 * disputes, which flatters any gate.
 *
 *   npx tsx eval/run_bot_replay.ts
 */
import { DATA, readJson, RESULTS, round, writeJson } from "./lib.js";
import { firstSpike, historyOf } from "./history.js";
import type { Row } from "./build_dataset.js";
import type { Prediction } from "./dispute.js";

const STAKE = 100, FEE = 0.02;
const test = readJson<Row[]>(new URL("test.json", DATA), []);
const predsA = readJson<Prediction[][]>(new URL("dispute_rules_predictions.json", DATA), [])[0] ?? [];
const predsC = readJson<Prediction[][]>(new URL("dispute_patterns_predictions.json", DATA), [])[0] ?? [];
const verdict = (ps: Prediction[], id: string) => ps.find((p) => p.id === id)?.verdict;
const summary = readJson<{ testWindow: { total: number; disputed: number } }>(new URL("dataset_summary.json", RESULTS), { testWindow: { total: 1, disputed: 0 } });
const baseRate = summary.testWindow.disputed / summary.testWindow.total;

interface Trade { id: string; question: string; disputed: boolean; yesWon: boolean; spike: number; at: string; pnl: number; vA?: string; vC?: string }
const trades: Trade[] = [];
let i = 0;
for (const r of test) {
  const pts = await historyOf(r);
  if (++i % 25 === 0) console.log(`histories ${i}/${test.length}`);
  const s = firstSpike(pts);
  if (!s) continue;
  const yesWon = /^yes$/i.test(r.outcome);
  const pnl = STAKE * ((yesWon ? 1 : 0) - s.p) / s.p;
  trades.push({ id: r.id, question: r.question, disputed: r.disputed, yesWon, spike: s.p, at: new Date(s.t * 1000).toISOString(), pnl, vA: verdict(predsA, r.id), vC: verdict(predsC, r.id) });
}

function book(gate: (t: Trade) => boolean, paysFees: boolean, weight: (t: Trade) => number = () => 1) {
  let pnl = 0, fees = 0, taken = 0, skipped = 0, skippedLosers = 0, skippedWinners = 0;
  for (const t of trades) {
    const w = weight(t);
    if (paysFees) fees += FEE * w;
    if (gate(t)) { pnl += t.pnl * w; taken += w; }
    else { skipped += w; if (t.pnl < 0) skippedLosers += w; else skippedWinners += w; }
  }
  return { trades: round(taken, 1), skipped: round(skipped, 1), skippedLosers: round(skippedLosers, 1), skippedWinners: round(skippedWinners, 1), grossPnl: round(pnl, 2), fees: round(fees, 2), netPnl: round(pnl - fees, 2) };
}

const disputedShare = trades.length ? trades.filter((t) => t.disputed).length / trades.length : 0;
const reweight = (t: Trade) => (t.disputed ? baseRate / Math.max(disputedShare, 1e-9) : (1 - baseRate) / Math.max(1 - disputedShare, 1e-9));
const has = trades.filter((t) => t.vA && t.vC);
const out = {
  command: "npx tsx eval/run_bot_replay.ts",
  strategy: "buy $100 YES on the first +15c/60m spike landing at 50-95c, hold to resolution; ruling fee 0.02 USDC",
  marketsWithSpike: trades.length, disputedAmongThem: trades.filter((t) => t.disputed).length, withBothRulings: has.length,
  balanced: { botAlone: book(() => true, false), gatedRulesOnly: book((t) => t.vA !== "HIGH", true), gatedFinePrint: book((t) => t.vC !== "HIGH", true) },
  reweightedToBaseRate: { baseRate: round(baseRate, 4), botAlone: book(() => true, false, reweight), gatedRulesOnly: book((t) => t.vA !== "HIGH", true, reweight), gatedFinePrint: book((t) => t.vC !== "HIGH", true, reweight) },
  trades,
};
writeJson(new URL("bot_replay.json", RESULTS), out);
console.log(JSON.stringify({ ...out, trades: undefined }, null, 2));
