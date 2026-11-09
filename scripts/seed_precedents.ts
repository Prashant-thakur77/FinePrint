/**
 * Seeds Walrus Memory (PRECEDENTS account) on mainnet:
 *   1. one PATTERN memory per wording pattern, with evidence counted over the
 *      whole precedent pool (closed before 2026)
 *   2. the precedents from eval/data/precedents.json, demo twin first
 * Writes go through rememberBulk (≤ 20 items) rotating delegate keys, with
 * backoff on 429. Resumable: markets already in eval/results/seed_log.json
 * are skipped. Every blob id is logged there.
 *
 * Distilling (LLM clause + CLOB crowd price) is cached in
 * eval/data/distilled.json; `--prepare` fills that cache without writing.
 *
 *   npx tsx scripts/seed_precedents.ts [max=400] [batch=10] [--prepare]
 */
import "dotenv/config";
import { existsSync } from "node:fs";
import { rememberBulkAndWait } from "../src/memory/client.js";
import { NS, patternText } from "../src/memory/types.js";
import { distil, patternEvidence } from "../src/precedents/distil.js";
import { DATA, readJson, RESULTS, writeJson } from "../eval/lib.js";
import type { Row } from "../eval/build_dataset.js";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const prepareOnly = process.argv.includes("--prepare");
const max = Number(args[0] ?? 400);
const batch = Math.min(20, Number(args[1] ?? 10));
const CACHE = new URL("distilled.json", DATA);
const cache = readJson<Record<string, string>>(CACHE, {});
async function textFor(r: Row): Promise<string> {
  if (!cache[r.id]) {
    cache[r.id] = (await distil({ id: r.id, question: r.question, rules: r.rules, tokens: r.tokens, closedTime: r.closedTime, outcome: r.outcome, uma: r.uma, disputed: r.disputed })).text;
    writeJson(CACHE, cache);
  }
  return cache[r.id];
}
const LOG = new URL("seed_log.json", RESULTS);

interface Entry { kind: "precedent" | "pattern"; ref: string; blobId: string; text: string; at: string; status: string }
const log = readJson<Entry[]>(LOG, []);
const done = new Set(log.filter((e) => e.status === "done").map((e) => `${e.kind}:${e.ref}`));
const save = () => writeJson(LOG, log);

async function write(kind: Entry["kind"], items: { ref: string; text: string; namespace: string }[]) {
  const res = await rememberBulkAndWait("PRECEDENTS", items.map((i) => ({ text: i.text, namespace: i.namespace })));
  res.forEach((r, i) => {
    log.push({ kind, ref: items[i].ref, blobId: r.blobId ?? "", text: items[i].text, at: new Date().toISOString(), status: r.status });
    if (r.status === "done") done.add(`${kind}:${items[i].ref}`);
  });
  save();
  console.log(`${kind}: wrote ${res.filter((r) => r.status === "done").length}/${items.length} (${done.size} total)`);
}

const pool = readJson<Row[]>(new URL("pool.json", DATA), []);
if (!pool.length) throw new Error("run eval/build_dataset.ts first");

if (prepareOnly) {
  const list = readJson<Row[]>(new URL("precedents.json", DATA), []).slice(0, max);
  for (let i = 0; i < list.length; i += 6) await Promise.all(list.slice(i, i + 6).map(textFor));
  console.log(`distilled ${Object.keys(cache).length} precedents into ${CACHE.pathname}`);
  process.exit(0);
}

// 1. Patterns (first version, evidence from the whole pool).
const ev = patternEvidence(pool);
writeJson(new URL("pattern_evidence.json", RESULTS), { command: "npx tsx scripts/seed_precedents.ts", poolSize: pool.length, baseRate: ev.base, patterns: ev.perPattern });
const patternItems = ev.perPattern.filter((p) => !done.has(`pattern:${p.tag}`)).map((p) => ({
  ref: p.tag, namespace: NS.patterns,
  text: patternText({ tag: p.tag, rule: `${p.rule} Pool dispute rate ${(p.rate * 100).toFixed(2)}% vs base ${(ev.base * 100).toFixed(2)}%.`, disputed: p.disputed, total: p.total, firstSeen: "seed", supersedes: "none" }),
}));
if (patternItems.length) await write("pattern", patternItems);

// 2. Precedents, twin first.
const list = readJson<Row[]>(new URL("precedents.json", DATA), []).slice(0, max);
const todo = list.filter((r) => !done.has(`precedent:${r.id}`));
console.log(`${todo.length} precedents to write`);
for (let i = 0; i < todo.length; i += batch) {
  const chunk = todo.slice(i, i + batch);
  const items = await Promise.all(chunk.map(async (r) => ({ ref: r.id, text: await textFor(r), namespace: NS.precedents })));
  try { await write("precedent", items); } catch (err) { console.error(`batch failed: ${(err as Error).message.slice(0, 200)}`); await new Promise((s) => setTimeout(s, 60_000)); i -= batch; }
}
console.log(existsSync(LOG) ? `log: ${LOG.pathname}` : "");
