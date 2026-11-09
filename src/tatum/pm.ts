/**
 * Tatum Prediction Market API (Polymarket + Kalshi): market rules, outcomes,
 * resolution and price history. Market ids are Polymarket condition ids
 * (0x + 64 hex) or Kalshi tickers.
 *
 * It carries the current rules only (no rule history, no dispute status), so
 * rule versions come from our own snapshots and the Polygon bulletin board.
 */
import { config } from "../config.js";
import { timed } from "./latency.js";
import { tatumSlot } from "./limit.js";

const BASE = "https://api.tatum.io/v4/data/prediction";

export interface PmOutcome { name: string; price: number; tokenId: string | null }
export interface PmMarket {
  id: string; platform: "polymarket" | "kalshi"; question: string; description: string | null; status: string;
  outcomes: PmOutcome[]; closeTime: string | null; openTime: string | null; settleTime?: string | null; createdAt: string | null;
  category: string | null; volume: number; eventId: string | null;
  resolution: { outcome: string; resolvedAt: string; source: string | null; txHash: string | null } | null;
  chain: { chainId: number; conditionId: string | null; tokenIds: { yes?: string; no?: string } | null; resolutionSource: string | null } | null;
  source: { platform: string; platformId: string; url: string };
}
export interface Candle { timestamp: string; open: number; high: number; low: number; close: number; volume: number }
export type Interval = "1m" | "5m" | "15m" | "1h" | "4h" | "1d" | "1w";

/**
 * Free-plan credits are scarce (a history call costs 200), so responses are
 * cached at the edge when running in the Worker: settled data for a day, live
 * data for a minute.
 */
const edgeCache = (): Cache | null => (typeof caches !== "undefined" && "default" in caches ? (caches as unknown as { default: Cache }).default : null);

async function get<T>(path: string, params: Record<string, string | number | undefined> = {}, ttlS = 60): Promise<T> {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]));
  const url = `${BASE}${path}${q.size ? `?${q}` : ""}`;
  const cache = edgeCache();
  const key = new Request(`https://tatum-cache.fineprint.internal${path}${q.size ? `?${q}` : ""}`);
  if (cache) {
    const hit = await cache.match(key);
    if (hit) return (await hit.json()) as T;
  }
  const body = await timed("tatum.pm", path.replace(/0x[0-9a-f]{64}/i, "{id}").replace(/\/\d+/g, "/{id}"), async () => {
    for (let attempt = 0; ; attempt++) {
      await tatumSlot();
      let r: Response;
      try { r = await fetch(url, { headers: { "x-api-key": config.tatumKey, accept: "application/json" }, signal: AbortSignal.timeout(30_000) }); }
      catch (err) { if (attempt < 3) { await new Promise((s) => setTimeout(s, 800 * 2 ** attempt)); continue; } throw err; }
      if ((r.status === 429 || r.status >= 500) && attempt < 3) { await new Promise((s) => setTimeout(s, 800 * 2 ** attempt)); continue; }
      if (!r.ok) throw Object.assign(new Error(`Tatum PM ${r.status} ${path}: ${(await r.text()).slice(0, 200)}`), { status: r.status });
      return (await r.json()) as T;
    }
  });
  if (cache) await cache.put(key, new Response(JSON.stringify(body), { headers: { "content-type": "application/json", "cache-control": `public, max-age=${ttlS}` } }));
  return body;
}

export async function pmMarket(id: string): Promise<PmMarket> {
  const r = await get<{ data: PmMarket } | PmMarket>(`/markets/${encodeURIComponent(id)}`, {}, 120);
  const m = "data" in r ? r.data : r;
  return m;
}

export async function pmMarkets(params: { platform?: string; status?: string; search?: string; endingBefore?: string; sort?: string; limit?: number; cursor?: string; minVolume?: number; category?: string }) {
  return get<{ data: PmMarket[]; pagination?: { cursor?: string; pageSize: number } }>("/markets", params);
}

export async function pmPrice(id: string) {
  return get<{ data: unknown }>(`/markets/${encodeURIComponent(id)}/price`);
}

const RANGE_CAP_S: Record<Interval, number> = { "1m": 86_400, "5m": 5 * 86_400, "15m": 14 * 86_400, "1h": 30 * 86_400, "4h": 90 * 86_400, "1d": 365 * 86_400, "1w": 3 * 365 * 86_400 };

/** Price history as OHLC candles; long ranges are fetched in chunks under the per-interval cap. */
export async function pmHistory(id: string, interval: Interval, start: Date, end: Date, source: "candlesticks" | "midpoint" = "midpoint"): Promise<Candle[]> {
  const cap = RANGE_CAP_S[interval] * 1000 * 0.95;
  const out: Candle[] = [];
  for (let s = start.getTime(); s < end.getTime(); s += cap) {
    const e = Math.min(end.getTime(), s + cap);
    // Windows that ended more than an hour ago never change: cache them for a day.
    const settled = e < Date.now() - 3600_000;
    const r = await get<{ data: { candles: Candle[] } }>(`/markets/${encodeURIComponent(id)}/history`, { interval, start: new Date(s).toISOString(), end: new Date(e).toISOString(), source }, settled ? 86_400 : 60);
    out.push(...r.data.candles);
  }
  // Midpoint is Polymarket-only and covers resolved markets, where candlesticks
  // can come back empty; Kalshi has candlesticks only.
  if (!out.length && source === "midpoint") return pmHistory(id, interval, start, end, "candlesticks");
  const seen = new Set<string>();
  return out.filter((c) => !seen.has(c.timestamp) && seen.add(c.timestamp)).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}
