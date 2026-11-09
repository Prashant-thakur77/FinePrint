/**
 * One market, everything the trader view needs: rules (Tatum PM, Gamma as
 * fallback), the price chart (Tatum PM history, CLOB as fallback), UMA status
 * history, and the rulings and rule versions to pin on the chart.
 */
import { clobHistory, gammaBySlug, gammaMarket, gammaMarkets, outcomeOf, type MarketRecord } from "./polymarket/gamma.js";
import { pmHistory, pmMarket, type Interval, type PmMarket } from "./tatum/pm.js";
import { log } from "./log.js";

export interface MarketInfo {
  id: string; conditionId: string; questionId: string; slug: string; question: string; rules: string;
  tokens: string[]; createdAt: string | null; closedTime: string | null; endDate: string | null;
  uma: string[]; outcome: string | null; closed: boolean; status: string; volume: number;
  rulesSource: "tatum" | "gamma";
}

export function parseRef(ref: string): { kind: "id" | "condition" | "slug"; value: string } {
  const s = decodeURIComponent(ref.trim());
  const url = /polymarket\.com\/(?:[a-z]{2}\/)?(?:event|market)\/([^/?#]+)(?:\/([^/?#]+))?/i.exec(s);
  if (url) return { kind: "slug", value: url[2] ?? url[1] };
  if (/^\d+$/.test(s)) return { kind: "id", value: s };
  if (/^0x[0-9a-f]{64}$/i.test(s)) return { kind: "condition", value: s.toLowerCase() };
  return { kind: "slug", value: s };
}

export async function loadMarket(ref: string): Promise<MarketInfo> {
  const r = parseRef(ref);
  let g: MarketRecord | null = null;
  if (r.kind === "id") g = await gammaMarket(r.value);
  else if (r.kind === "slug") g = await gammaBySlug(r.value);
  else g = (await gammaMarkets({ condition_ids: r.value, limit: 1 }))[0] ?? null;
  if (!g) throw Object.assign(new Error("market not found"), { status: 404 });

  let pm: PmMarket | null = null;
  if (g.conditionId) {
    try { pm = await pmMarket(g.conditionId); } catch (err) { log.warn("tatum.pm.market_failed", { id: g.id, error: (err as Error).message.slice(0, 160) }); }
  }
  const rules = pm?.description?.trim() || g.description;
  return {
    id: g.id, conditionId: g.conditionId, questionId: g.questionId, slug: g.slug, question: pm?.question || g.question, rules,
    tokens: g.tokens, createdAt: g.createdAt, closedTime: g.closedTime, endDate: g.endDate, uma: g.uma,
    outcome: pm?.resolution?.outcome ?? (g.closed ? outcomeOf(g) : null), closed: g.closed, status: pm?.status ?? (g.closed ? "closed" : "active"),
    volume: g.volume, rulesSource: pm?.description ? "tatum" : "gamma",
  };
}

export interface Point { t: number; p: number }

function pickInterval(spanS: number): Interval {
  if (spanS <= 86_400) return "1m";
  if (spanS <= 5 * 86_400) return "5m";
  if (spanS <= 14 * 86_400) return "15m";
  if (spanS <= 60 * 86_400) return "1h";
  return "4h";
}

/** YES price series for a window (unix seconds). */
export async function priceSeries(m: MarketInfo, from: number, to: number, interval?: Interval): Promise<{ source: string; interval: string; points: Point[] }> {
  const iv = interval ?? pickInterval(to - from);
  try {
    const candles = await pmHistory(m.conditionId, iv, new Date(from * 1000), new Date(to * 1000));
    if (candles.length) return { source: "tatum", interval: iv, points: candles.map((c) => ({ t: Math.floor(Date.parse(c.timestamp) / 1000), p: c.close })) };
  } catch (err) {
    log.warn("tatum.pm.history_failed", { id: m.id, error: (err as Error).message.slice(0, 160) });
  }
  const fidelity = iv === "1m" ? 1 : iv === "5m" ? 5 : iv === "15m" ? 15 : iv === "1h" ? 60 : 240;
  const pts = m.tokens[0] ? await clobHistory(m.tokens[0], from, to, fidelity) : [];
  return { source: "clob", interval: iv, points: pts };
}

/** Default chart window: the whole life of the market, or the last 7 days if it is still open. */
export function defaultWindow(m: MarketInfo): [number, number] {
  const now = Math.floor(Date.now() / 1000);
  const end = m.closedTime ? Math.floor(Date.parse(m.closedTime) / 1000) + 3600 : now;
  const start = m.createdAt ? Math.floor(Date.parse(m.createdAt) / 1000) : end - 7 * 86_400;
  return [Math.max(start, end - 90 * 86_400), end];
}
