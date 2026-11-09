/**
 * Every number in the MSTR story, measured from Polymarket CLOB minute data
 * for market 2169995 ("MicroStrategy sells any Bitcoin by May 31, 2026?") on
 * 1 June 2026, plus the twin precedent 516926 from Gamma.
 *
 *   npx tsx eval/mstr_story.ts
 */
import { clobHistory, gammaMarket } from "../src/polymarket/gamma.js";
import { RESULTS, round, writeJson } from "./lib.js";

const m = await gammaMarket("2169995");
const twin = await gammaMarket("516926");
const day = Date.parse("2026-06-01T00:00:00Z") / 1000;
const pts = await clobHistory(m.tokens[0], day + 6 * 3600, day + 20 * 3600, 1);
const hhmm = (t: number) => new Date(t * 1000).toISOString().slice(11, 16);
const at = (h: string) => pts.find((p) => hhmm(p.t) === h)?.p ?? null;

const pre = pts.filter((p) => hhmm(p.t) < "11:45");
const baseline = pre.length ? pre[pre.length - 1].p : null;
const spike = pts.find((p) => p.p >= 0.8)!; // first minute at 80c or more
// Cliff: the minute-to-minute fall that ends below 5c.
let cliffIdx = -1;
for (let i = 1; i < pts.length; i++) if (pts[i - 1].p > 0.3 && pts[i].p < 0.05) { cliffIdx = i; break; }
const cliffEnd = pts[cliffIdx], cliffStartPt = pts[cliffIdx - 2] ?? pts[cliffIdx - 1];
const window = pts.filter((p) => p.t >= spike.t && p.t <= cliffStartPt.t);
const lo = Math.min(...window.map((p) => p.p)), hi = Math.max(...window.map((p) => p.p));
const windowMin = (cliffStartPt.t - spike.t) / 60;

const out = {
  command: "npx tsx eval/mstr_story.ts",
  source: "https://clob.polymarket.com/prices-history (fidelity=1), Gamma /markets/2169995 and /markets/516926",
  market: { id: m.id, question: m.question, conditionId: m.conditionId, uma: m.uma, closedTime: m.closedTime, outcomePrices: m.outcomePrices },
  twin: { id: twin.id, question: twin.question, uma: twin.uma, closedTime: twin.closedTime, outcome: twin.outcomes[twin.outcomePrices.findIndex((p) => p >= 0.99)], sameRulesText: twin.description.replace(/December 31, 2025, 11:59 PM ET/, "X").slice(0, 120) === m.description.replace(/11:59 PM ET on the date specified in the title/, "X").slice(0, 120) },
  baselineBefore1145: baseline,
  spike: { firstAtOrAbove80c: hhmm(spike.t), price: spike.p },
  price1220: at("12:20"),
  window: { from: hhmm(spike.t), to: hhmm(cliffStartPt.t), minutes: windowMin, hoursMinutes: `${Math.floor(windowMin / 60)}h ${Math.round(windowMin % 60)}m`, low: round(lo, 4), high: round(hi, 4) },
  window1220: (() => { const w = pts.filter((p) => hhmm(p.t) >= "12:20" && p.t <= cliffStartPt.t); const mins = (cliffStartPt.t - Date.parse("2026-06-01T12:20:00Z") / 1000) / 60; return { from: "12:20", to: hhmm(cliffStartPt.t), minutes: mins, hoursMinutes: `${Math.floor(mins / 60)}h ${Math.round(mins % 60)}m`, low: round(Math.min(...w.map((p) => p.p)), 4), high: round(Math.max(...w.map((p) => p.p)), 4) }; })(),
  cliff: { from: hhmm(cliffStartPt.t), fromPrice: cliffStartPt.p, to: hhmm(cliffEnd.t), toPrice: cliffEnd.p, minutes: (cliffEnd.t - cliffStartPt.t) / 60, at1659: at("16:59"), at1700: at("17:00"), at1701: at("17:01") },
  points: pts.length,
};
writeJson(new URL("mstr_story.json", RESULTS), out);
console.log(JSON.stringify(out, null, 2));
