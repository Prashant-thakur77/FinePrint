/** Cached CLOB price history for eval markets (YES token, 5-minute points over the last 14 days of trading). */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { clobHistory, type PricePoint } from "../src/polymarket/gamma.js";
import { DATA } from "./lib.js";
import type { Row } from "./build_dataset.js";

const DIR = new URL("histories/", DATA);
mkdirSync(DIR, { recursive: true });

export async function historyOf(r: Row, days = 14, fidelity = 5): Promise<PricePoint[]> {
  const f = new URL(`${r.id}.json`, DIR);
  if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8"));
  if (!r.tokens[0]) return [];
  const end = Math.floor(Date.parse(r.closedTime) / 1000) + 3600;
  const created = r.createdAt ? Math.floor(Date.parse(r.createdAt) / 1000) : end - days * 86400;
  const pts = await clobHistory(r.tokens[0], Math.max(created, end - days * 86400), end, fidelity).catch(() => []);
  writeFileSync(f, JSON.stringify(pts));
  return pts;
}

/** First moment YES rose by at least `jump` within `windowS` to a level between 0.5 and 0.95: the bot's buy signal. */
export function firstSpike(pts: PricePoint[], jump = 0.15, windowS = 3600): { t: number; p: number; from: number } | null {
  let lo = 0;
  for (let i = 0; i < pts.length; i++) {
    while (pts[lo].t < pts[i].t - windowS) lo++;
    let min = Infinity;
    for (let j = lo; j <= i; j++) min = Math.min(min, pts[j].p);
    if (pts[i].p - min >= jump && pts[i].p >= 0.5 && pts[i].p <= 0.95) return { t: pts[i].t, p: pts[i].p, from: min };
  }
  return null;
}

/** The steepest fall: the largest price drop completed within `windowS`. */
export function cliff(pts: PricePoint[], windowS = 600, minDrop = 0.3): { start: number; end: number; from: number; to: number } | null {
  let best: { start: number; end: number; from: number; to: number } | null = null;
  let lo = 0;
  for (let i = 0; i < pts.length; i++) {
    while (pts[lo].t < pts[i].t - windowS) lo++;
    for (let j = lo; j < i; j++) {
      const drop = pts[j].p - pts[i].p;
      if (drop >= minDrop && (!best || drop > best.from - best.to)) best = { start: pts[j].t, end: pts[i].t, from: pts[j].p, to: pts[i].p };
    }
  }
  return best;
}
