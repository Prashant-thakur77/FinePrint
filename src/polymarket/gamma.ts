/**
 * Polymarket public data: Gamma (market metadata, rules, UMA status history)
 * and the CLOB price history. No key needed. Gamma intermittently drops TLS
 * handshakes or returns an empty body, so every call retries.
 */
const GAMMA = "https://gamma-api.polymarket.com";
const CLOB = "https://clob.polymarket.com";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function getJson<T>(url: string, tries = 6): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { accept: "application/json", "user-agent": "fineprint/0.1" }, signal: AbortSignal.timeout(30_000) });
      if (r.status === 429 || r.status >= 500) throw new Error(`HTTP ${r.status}`);
      if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status} ${url}`), { fatal: true });
      const text = await r.text();
      if (!text) throw new Error("empty body");
      return JSON.parse(text) as T;
    } catch (err) {
      if ((err as { fatal?: boolean }).fatal) throw err;
      last = err;
      await sleep(500 * 2 ** i);
    }
  }
  throw last;
}

export interface GammaMarket {
  id: string; question: string; description: string; conditionId: string; questionID?: string;
  slug?: string; clobTokenIds?: string; outcomes?: string; outcomePrices?: string;
  umaResolutionStatuses?: string | string[]; umaResolutionStatus?: string;
  closedTime?: string; endDate?: string; createdAt?: string; startDate?: string;
  volume?: string; volumeNum?: number; resolvedBy?: string; resolutionSource?: string; negRisk?: boolean;
  closed?: boolean; active?: boolean; lastTradePrice?: number;
  events?: { id: string; title: string; slug: string; description?: string }[];
}

/** The compact record Fine Print keeps for each market. */
export interface MarketRecord {
  id: string; question: string; description: string; conditionId: string; questionId: string;
  slug: string; event: string; tokens: string[]; outcomes: string[]; outcomePrices: number[];
  uma: string[]; closedTime: string | null; endDate: string | null; createdAt: string | null;
  volume: number; resolvedBy: string; resolutionSource: string; negRisk: boolean; closed: boolean;
}

const parseList = <T>(v: unknown): T[] => {
  if (Array.isArray(v)) return v as T[];
  if (typeof v === "string" && v.startsWith("[")) { try { return JSON.parse(v) as T[]; } catch { /* fallthrough */ } }
  return [];
};

const iso = (s?: string) => (s ? new Date(s.replace(" ", "T").replace(/\+00$/, "Z")).toISOString() : null);

export function toRecord(m: GammaMarket): MarketRecord {
  return {
    id: String(m.id), question: m.question ?? "", description: m.description ?? "", conditionId: m.conditionId ?? "",
    questionId: m.questionID ?? "", slug: m.slug ?? "", event: m.events?.[0]?.title ?? "",
    tokens: parseList<string>(m.clobTokenIds), outcomes: parseList<string>(m.outcomes), outcomePrices: parseList<string>(m.outcomePrices).map(Number),
    uma: parseList<string>(m.umaResolutionStatuses), closedTime: iso(m.closedTime), endDate: iso(m.endDate), createdAt: iso(m.createdAt),
    volume: Number(m.volumeNum ?? m.volume ?? 0), resolvedBy: m.resolvedBy ?? "", resolutionSource: m.resolutionSource ?? "",
    negRisk: Boolean(m.negRisk), closed: Boolean(m.closed),
  };
}

export async function gammaMarket(id: string): Promise<MarketRecord> {
  return toRecord(await getJson<GammaMarket>(`${GAMMA}/markets/${encodeURIComponent(id)}`));
}

export async function gammaBySlug(slug: string): Promise<MarketRecord | null> {
  const list = await getJson<GammaMarket[]>(`${GAMMA}/markets?slug=${encodeURIComponent(slug)}`);
  return list[0] ? toRecord(list[0]) : null;
}

/** One page (max 100) of markets matching Gamma query params. */
export async function gammaMarkets(params: Record<string, string | number | boolean>): Promise<MarketRecord[]> {
  const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  return (await getJson<GammaMarket[]>(`${GAMMA}/markets?${q}`)).map(toRecord);
}

/** Outcome of a resolved binary market, from its final prices. */
export function outcomeOf(m: MarketRecord): string | null {
  const i = m.outcomePrices.findIndex((p) => p >= 0.99);
  return i >= 0 ? (m.outcomes[i] ?? null) : null;
}

export const wasDisputed = (m: MarketRecord) => m.uma.includes("disputed");

export interface PricePoint { t: number; p: number }

/** CLOB price history for one outcome token, in seconds. Chunked: the CLOB limits fine-grained windows. */
export async function clobHistory(tokenId: string, startTs: number, endTs: number, fidelityMin = 1): Promise<PricePoint[]> {
  const chunk = fidelityMin <= 1 ? 6 * 86400 : 30 * 86400;
  const out: PricePoint[] = [];
  for (let s = startTs; s < endTs; s += chunk) {
    const e = Math.min(endTs, s + chunk);
    const r = await getJson<{ history: PricePoint[] }>(`${CLOB}/prices-history?market=${tokenId}&startTs=${s}&endTs=${e}&fidelity=${fidelityMin}`);
    out.push(...(r.history ?? []));
  }
  const seen = new Set<number>();
  return out.filter((x) => !seen.has(x.t) && seen.add(x.t)).sort((a, b) => a.t - b.t);
}

export function categoryOf(m: Pick<MarketRecord, "question" | "event" | "description">): string {
  const s = `${m.question} ${m.event}`.toLowerCase();
  if (/\b(bitcoin|btc|ethereum|eth|solana|sol|xrp|crypto|token|coin|doge|microstrategy|mstr|airdrop|fdv|memecoin|binance|coinbase|etf)\b/.test(s)) return "crypto";
  if (/\b(vs\.?|nba|nfl|mlb|nhl|ufc|fifa|premier league|la liga|serie a|champions league|world cup|grand prix|f1|tennis|open|match|game \d|win the|super bowl|playoffs|stanley cup|o\/u|spread|goals|touchdown|cricket|ipl)\b/.test(s)) return "sports";
  if (/\b(election|president|trump|biden|harris|senate|congress|governor|parliament|minister|vote|poll|democrat|republican|party|putin|zelensky|nato|war|ceasefire|israel|iran|ukraine|russia|china|tariff|supreme court|impeach)\b/.test(s)) return "politics";
  if (/\b(fed|rate|inflation|cpi|gdp|recession|stock|s&p|nasdaq|dow|earnings|ipo|market cap|unemployment|oil|gold)\b/.test(s)) return "economics";
  if (/\b(album|song|movie|film|box office|oscar|grammy|emmy|tweet|elon|musk|spotify|youtube|tiktok|netflix|celebrity|taylor swift|kanye|mrbeast|gta)\b/.test(s)) return "culture";
  if (/\b(ai|openai|gpt|gemini|claude|apple|google|tesla|spacex|launch|iphone|nvidia)\b/.test(s)) return "tech";
  return "other";
}
