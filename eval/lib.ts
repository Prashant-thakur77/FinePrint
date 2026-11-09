/** Shared helpers for eval scripts: deterministic RNG, JSONL io, metrics. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

export const DATA = new URL("./data/", import.meta.url);
export const RESULTS = new URL("./results/", import.meta.url);
mkdirSync(DATA, { recursive: true });
mkdirSync(RESULTS, { recursive: true });

export function readJsonl<T>(url: URL): T[] {
  if (!existsSync(url)) return [];
  return readFileSync(url, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as T);
}
export const writeJson = (url: URL, v: unknown) => writeFileSync(url, JSON.stringify(v, null, 2) + "\n");
export const readJson = <T>(url: URL, fallback: T): T => (existsSync(url) ? (JSON.parse(readFileSync(url, "utf8")) as T) : fallback);

/** mulberry32: small seeded PRNG so splits and samples are reproducible. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function shuffle<T>(xs: T[], rand: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export interface Metrics { n: number; accuracy: number; precision: number; recall: number; f1: number; topBucketPrecision: number; topBucketN: number }

/** Binary metrics with "disputed" as the positive class. Top bucket = the highest-scored 20%. */
export function metrics(rows: { label: boolean; pred: boolean; score: number }[]): Metrics {
  const tp = rows.filter((r) => r.pred && r.label).length, fp = rows.filter((r) => r.pred && !r.label).length;
  const fn = rows.filter((r) => !r.pred && r.label).length, tn = rows.filter((r) => !r.pred && !r.label).length;
  const precision = tp + fp ? tp / (tp + fp) : 0, recall = tp + fn ? tp / (tp + fn) : 0;
  const top = [...rows].sort((a, b) => b.score - a.score).slice(0, Math.max(1, Math.round(rows.length * 0.2)));
  return {
    n: rows.length, accuracy: rows.length ? (tp + tn) / rows.length : 0, precision, recall,
    f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0,
    topBucketPrecision: top.filter((r) => r.label).length / top.length, topBucketN: top.length,
  };
}

export const round = (x: number, d = 3) => Math.round(x * 10 ** d) / 10 ** d;
