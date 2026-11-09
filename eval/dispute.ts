/**
 * Dispute prediction on the held-out 2026 test set. One model, three
 * conditions, one change each:
 *   rules       (a) rule text only
 *   precedents  (b) + precedent recall from Walrus Memory
 *   patterns    (c) + learned wording patterns
 * Leakage guard: a test market only sees precedents that closed before the
 * test market was created. Recall results are cached per market so repeats
 * differ only in the model's sampling.
 */
import "dotenv/config";
import { judge, type Level } from "../src/court/judge.js";
import { filterPrecedents, recallPatterns } from "../src/court/ruling.js";
import { recall } from "../src/memory/client.js";
import { fields, NS } from "../src/memory/types.js";
import { DATA, metrics, readJson, RESULTS, round, writeJson, type Metrics } from "./lib.js";
import type { Row } from "./build_dataset.js";

const RECALL = new URL("recall_cache.json", DATA);

export interface Prediction { id: string; category: string; label: boolean; verdict: string; p: number; pred: boolean; cites: string[]; nPrecedents: number; nearestDisputed: boolean | null; error?: string }

export async function runDispute(level: Level, repeats: number, limit: number, concurrency = 4) {
  const test = readJson<Row[]>(new URL("test.json", DATA), []).slice(0, limit);
  if (!test.length) throw new Error("no test set: run eval/build_dataset.ts");
  const cache = readJson<Record<string, { precedents: any[]; patterns: any[] }>>(RECALL, {});
  // Only the seeded precedent pool (closed before 2026) is eligible, so the
  // A/B never sees outcomes the live court wrote back later.
  const seeded = new Set(readJson<{ kind: string; ref: string; status: string }[]>(new URL("seed_log.json", RESULTS), []).filter((e) => e.kind === "precedent" && e.status === "done").map((e) => e.ref));
  if (level !== "rules") {
    let n = 0;
    for (const r of test) {
      if (cache[r.id]) continue;
      const m = { id: r.id, question: r.question, rules: r.rules, createdAt: r.createdAt };
      const patient = async <T>(fn: () => Promise<T>): Promise<T> => {
        for (let i = 0; ; i++) { try { return await fn(); } catch (err) { if (i >= 4) throw err; console.error(`recall retry ${i + 1}: ${(err as Error).message.slice(0, 80)}`); await new Promise((s) => setTimeout(s, 10_000 * (i + 1))); } }
      };
      const hits = (await patient(() => recall("PRECEDENTS", NS.precedents, `${m.question}\n${m.rules.slice(0, 600)}`, 40))).filter((h) => seeded.has(fields(h.text).market));
      cache[r.id] = { precedents: filterPrecedents(hits, { asOf: r.createdAt ?? r.closedTime, k: 8, excludeMarket: r.id }), patterns: await patient(() => recallPatterns(r.patterns)) };
      if (++n % 10 === 0) { writeJson(RECALL, cache); console.log(`recalled ${n}`); }
    }
    writeJson(RECALL, cache);
  }

  const runs: { metrics: Metrics; predictions: Prediction[] }[] = [];
  for (let rep = 0; rep < repeats; rep++) {
    const preds: Prediction[] = new Array(test.length);
    let next = 0;
    await Promise.all(Array.from({ length: concurrency }, async () => {
      for (let i = next++; i < test.length; i = next++) {
        const r = test[i];
        const ev = cache[r.id] ?? { precedents: [], patterns: [] };
        try {
          const j = await judge({ title: r.question, rules: r.rules, level, precedents: ev.precedents, patterns: level === "patterns" ? ev.patterns : [] });
          preds[i] = { id: r.id, category: r.category, label: r.disputed, verdict: j.verdict, p: j.pDispute, pred: j.verdict === "HIGH", cites: j.cites, nPrecedents: ev.precedents.length, nearestDisputed: ev.precedents[0]?.disputed ?? null };
        } catch (err) {
          preds[i] = { id: r.id, category: r.category, label: r.disputed, verdict: "ERR", p: 0, pred: false, cites: [], nPrecedents: ev.precedents.length, nearestDisputed: null, error: (err as Error).message.slice(0, 120) };
        }
      }
    }));
    const ok = preds.filter((p) => p.verdict !== "ERR");
    runs.push({ metrics: metrics(ok.map((p) => ({ label: p.label, pred: p.pred, score: p.p }))), predictions: preds });
    console.log(`${level} run ${rep + 1}: acc ${round(runs[rep].metrics.accuracy)} f1 ${round(runs[rep].metrics.f1)} errors ${preds.length - ok.length}`);
  }

  const keys = ["accuracy", "f1", "precision", "recall", "topBucketPrecision"] as const;
  const summary = Object.fromEntries(keys.map((k) => {
    const xs = runs.map((r) => r.metrics[k]);
    return [k, { mean: round(xs.reduce((a, b) => a + b, 0) / xs.length), min: round(Math.min(...xs)), max: round(Math.max(...xs)) }];
  }));
  // Per-category accuracy (first run) and whether the market had any precedents.
  const first = runs[0].predictions.filter((p) => p.verdict !== "ERR");
  const byCat: Record<string, { n: number; accuracy: number }> = {};
  for (const cat of [...new Set(first.map((p) => p.category))]) {
    const xs = first.filter((p) => p.category === cat);
    byCat[cat] = { n: xs.length, accuracy: round(xs.filter((p) => p.pred === p.label).length / xs.length) };
  }
  const withPrec = first.filter((p) => p.nPrecedents > 0), without = first.filter((p) => p.nPrecedents === 0);
  const out = {
    command: `npx tsx eval/${level === "rules" ? "run_baseline" : "run_fineprint"}.ts ${level} ${repeats} ${limit}`,
    model: process.env.LLM_MODEL ?? "claude-sonnet-4-5", level, repeats, n: test.length,
    positives: test.filter((r) => r.disputed).length, summary, runs: runs.map((r) => r.metrics), byCategory: byCat,
    withPrecedents: { n: withPrec.length, accuracy: withPrec.length ? round(withPrec.filter((p) => p.pred === p.label).length / withPrec.length) : null },
    withoutPrecedents: { n: without.length, accuracy: without.length ? round(without.filter((p) => p.pred === p.label).length / without.length) : null },
    citedShare: level === "rules" ? null : round(first.filter((p) => p.cites.length > 0).length / first.length),
  };
  writeJson(new URL(`dispute_${level}.json`, RESULTS), out);
  writeJson(new URL(`dispute_${level}_predictions.json`, DATA), runs.map((r) => r.predictions));
  console.log(JSON.stringify(out.summary));
  return out;
}
