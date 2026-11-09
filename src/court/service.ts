/**
 * The court as a service: issue rulings (sold or previewed), track the memory
 * jobs that seal them on Walrus, and grade them when markets resolve.
 */
import { fields, gradeText, NS, patternText, precedentText, type Verdict } from "../memory/types.js";
import { jobStatus, rememberAsync, type AccountName } from "../memory/client.js";
import { loadMarket, type MarketInfo } from "../market.js";
import { log } from "../log.js";
import { patternRule, tagMarket } from "../patterns/patterns.js";
import { refund } from "../pay/refund.js";
import { gammaMarket } from "../polymarket/gamma.js";
import { recordGrade, trackFor } from "./board.js";
import type { Level } from "./judge.js";
import { rule, seal, type RulingResult } from "./ruling.js";

export interface Sale { price: number; payer: string; digest: string }

export interface IssuedRuling {
  id: string; market: string; question: string; level: Level; verdict: Verdict; pDispute: number; patterns: string[];
  cites: { blobId: string; market?: string; closed?: string; disputed?: boolean; text: string }[];
  reasons: string[]; clause: string; at: number; jobId: string | null; blobId: string | null; sale: Sale | null; cached: boolean;
  precedentsConsidered: number;
}

async function trackJob(db: D1Database, jobId: string, account: AccountName, namespace: string, kind: string, ref: string) {
  await db.prepare("INSERT OR IGNORE INTO memory_jobs (job_id, account, namespace, kind, ref, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)")
    .bind(jobId, account, namespace, kind, ref, Date.now()).run();
}

function toIssued(id: string, r: RulingResult, at: number, jobId: string | null, sale: Sale | null): IssuedRuling {
  const evidence = [...r.precedents, ...r.patternEvidence.map((p) => ({ ...p, market: undefined, closed: undefined, disputed: undefined }))];
  return {
    id, market: r.market, question: r.question, level: r.level, verdict: r.verdict, pDispute: r.pDispute, patterns: r.patterns,
    cites: r.cites.map((c) => { const e = evidence.find((x) => x.blobId === c); return { blobId: c, market: e?.market, closed: e?.closed, disputed: e?.disputed, text: e?.text ?? "" }; }),
    reasons: r.reasons, clause: r.clause, at, jobId, blobId: null, sale, cached: false, precedentsConsidered: r.precedents.length,
  };
}

/** Runs the pipeline for a market and seals the result. `sale` is null for UI previews. */
export async function issue(db: D1Database, market: MarketInfo, level: Level, sale: Sale | null, crowdYes: number | null = null, asOf: string | null = null): Promise<IssuedRuling & { asOf: string | null }> {
  const r = await rule({ id: market.id, question: market.question, rules: market.rules, createdAt: market.createdAt }, level, { asOf, track: (tags) => trackFor(db, tags) });
  const id = crypto.randomUUID();
  const at = Date.now();
  let jobId: string | null = null;
  if (level !== "rules") {
    // Memory-off previews are not sealed: they exist only to show the before/after.
    try {
      const s = await seal(r, sale ?? { price: 0, payer: "", digest: "" });
      jobId = s.jobId;
      await trackJob(db, jobId, "COURT", NS.rulings, "ruling", id);
    } catch (err) {
      log.error("ruling.seal_failed", err, { market: market.id });
    }
  }
  await db.prepare(`INSERT INTO rulings (id, market, question, level, verdict, p_dispute, patterns, cites, reasons, clause, crowd_yes, at, price, payer, digest, job_id, asof)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    id, market.id, market.question, level, r.verdict, r.pDispute, JSON.stringify(r.patterns), JSON.stringify(toIssued(id, r, at, jobId, sale).cites),
    JSON.stringify(r.reasons), r.clause, crowdYes, at, sale ? String(sale.price) : null, sale?.payer ?? null, sale?.digest ?? null, jobId, asOf,
  ).run();
  if (sale) await db.prepare("UPDATE payments SET ruling_id = ? WHERE digest = ?").bind(id, sale.digest).run();
  return { ...toIssued(id, r, at, jobId, sale), asOf };
}

/** A recent preview for the same market and level, so page views do not each cost an LLM call. */
export async function cachedPreview(db: D1Database, market: string, level: Level, maxAgeMs = 30 * 60_000): Promise<IssuedRuling | null> {
  const row = await db.prepare("SELECT * FROM rulings WHERE market = ? AND level = ? AND at > ? AND asof IS NULL ORDER BY at DESC LIMIT 1").bind(market, level, Date.now() - maxAgeMs).first<RulingRow>();
  return row ? { ...rowToIssued(row), cached: true } : null;
}

export interface RulingRow {
  id: string; market: string; question: string; level: Level; verdict: Verdict; p_dispute: number; patterns: string; cites: string; reasons: string;
  clause: string | null; crowd_yes: number | null; at: number; price: string | null; payer: string | null; digest: string | null; job_id: string | null; blob_id: string | null;
  status: string; asof: string | null; outcome: string | null; disputed: number | null; correct: number | null; refund_digest: string | null; grade_job_id: string | null; grade_blob_id: string | null; graded_at: number | null;
}

export function rowToIssued(r: RulingRow): IssuedRuling & { asOf: string | null } {
  return {
    asOf: r.asof ?? null,
    id: r.id, market: r.market, question: r.question, level: r.level, verdict: r.verdict, pDispute: r.p_dispute, patterns: JSON.parse(r.patterns),
    cites: JSON.parse(r.cites), reasons: JSON.parse(r.reasons), clause: r.clause ?? "", at: r.at, jobId: r.job_id, blobId: r.blob_id,
    sale: r.digest ? { price: Number(r.price), payer: r.payer ?? "", digest: r.digest } : null, cached: false, precedentsConsidered: 0,
  };
}

/** Moves relayer jobs from pending to done and copies blob ids onto rulings and grades. */
export async function resolveJobs(db: D1Database, max = 25) {
  const jobs = (await db.prepare("SELECT job_id, account, kind, ref FROM memory_jobs WHERE status = 'pending' ORDER BY created_at LIMIT ?").bind(max).all<{ job_id: string; account: AccountName; kind: string; ref: string }>()).results;
  let done = 0;
  for (const j of jobs) {
    try {
      const s = await jobStatus(j.account, j.job_id);
      if (s.status === "done" && s.blob_id) {
        await db.prepare("UPDATE memory_jobs SET status = 'done', blob_id = ?, done_at = ? WHERE job_id = ?").bind(s.blob_id, Date.now(), j.job_id).run();
        if (j.kind === "ruling") await db.prepare("UPDATE rulings SET blob_id = ? WHERE id = ?").bind(s.blob_id, j.ref).run();
        if (j.kind === "grade") await db.prepare("UPDATE rulings SET grade_blob_id = ? WHERE id = ?").bind(s.blob_id, j.ref).run();
        if (j.kind === "rules") { const [market, n] = j.ref.split("#"); await db.prepare("UPDATE rule_versions SET blob_id = ? WHERE market = ? AND n = ?").bind(s.blob_id, market, Number(n)).run(); }
        if (j.kind === "precedent") await db.prepare("UPDATE changes SET cause_blob = ? WHERE cause_blob = ?").bind(s.blob_id, `job:${j.job_id}`).run();
        if (j.kind === "pattern") {
          const row = await db.prepare("SELECT v FROM kv WHERE k = ?").bind(`pattern:${j.ref}`).first<{ v: string }>();
          if (row) { const st = JSON.parse(row.v); if (st.latest === `job:${j.job_id}`) { st.latest = s.blob_id; await db.prepare("UPDATE kv SET v = ? WHERE k = ?").bind(JSON.stringify(st), `pattern:${j.ref}`).run(); } }
        }
        done++;
      } else if (s.status === "failed" || s.status === "not_found") {
        await db.prepare("UPDATE memory_jobs SET status = ? WHERE job_id = ?").bind(s.status, j.job_id).run();
      }
    } catch (err) {
      log.warn("jobs.status_failed", { job: j.job_id, error: (err as Error).message.slice(0, 120) });
    }
  }
  return { checked: jobs.length, done };
}

/**
 * Grades open rulings whose market has resolved. HIGH predicts a dispute;
 * MED and LOW predict none (the same threshold the eval uses). A paid LOW
 * ruling that ends in a dispute, or in the outcome the crowd priced as less
 * likely at ruling time, is refunded in USDC. Each resolution is also written
 * back as a new precedent, which is how the court learns.
 */
export async function gradeOpen(db: D1Database, max = 8) {
  const open = (await db.prepare("SELECT * FROM rulings WHERE status = 'open' AND level != 'rules' ORDER BY at LIMIT 200").all<RulingRow>()).results;
  const byMarket = new Map<string, RulingRow[]>();
  for (const r of open) byMarket.set(r.market, [...(byMarket.get(r.market) ?? []), r]);
  const graded: { ruling: string; market: string; correct: boolean; refund: string | null }[] = [];
  // Check a random sample each run: a Worker run has a small subrequest budget,
  // and markets that have not closed yet must not starve the ones that have.
  const sample = [...byMarket].sort(() => Math.random() - 0.5).slice(0, max);
  for (const [marketId, rulings] of sample) {
    let g;
    try { g = await gammaMarket(marketId); } catch { continue; }
    const finalStatus = g.uma[g.uma.length - 1];
    if (!g.closed || !g.closedTime || finalStatus !== "resolved" && !(g.outcomePrices.some((p) => p >= 0.99))) continue;
    const outcome = g.outcomes[g.outcomePrices.findIndex((p) => p >= 0.99)] ?? "unknown";
    const disputed = g.uma.includes("disputed");
    const closedAt = Date.parse(g.closedTime);
    // Only live forecasts count: a ruling issued after the market closed, or a
    // replay ruling (asOf), is never graded and never moves prices.
    const live = rulings.filter((r) => !r.asof && r.at < closedAt);
    for (const r of rulings.filter((x) => !live.includes(x))) {
      await db.prepare("UPDATE rulings SET status = ?, outcome = ?, disputed = ?, graded_at = ? WHERE id = ?").bind(r.asof ? "replay" : "after-close", outcome, disputed ? 1 : 0, Date.now(), r.id).run();
    }
    for (const r of live) {
      const predictedDispute = r.verdict === "HIGH";
      const correct = predictedDispute === disputed;
      const yesWon = /^yes$/i.test(outcome);
      const contrarian = r.crowd_yes != null && ((yesWon && r.crowd_yes < 0.5) || (!yesWon && r.crowd_yes > 0.5));
      let refundDigest: string | null = null;
      if (r.verdict === "LOW" && r.digest && r.payer && r.price && (disputed || contrarian)) {
        try { refundDigest = await refund(r.payer, r.price); } catch (err) { log.error("refund.failed", err, { ruling: r.id }); }
      }
      const pats = JSON.parse(r.patterns) as string[];
      let gradeJob: string | null = null;
      try {
        gradeJob = await rememberAsync("COURT", NS.track, gradeText({ ruling: r.blob_id ?? `job:${r.job_id}`, market: marketId, verdict: r.verdict, pattern: pats, outcome, disputed, correct, refund: refundDigest ?? "" }));
        await trackJob(db, gradeJob, "COURT", NS.track, "grade", r.id);
      } catch (err) { log.error("grade.memory_failed", err, { ruling: r.id }); }
      await db.prepare("UPDATE rulings SET status = 'graded', outcome = ?, disputed = ?, correct = ?, refund_digest = ?, grade_job_id = ?, graded_at = ? WHERE id = ?")
        .bind(outcome, disputed ? 1 : 0, correct ? 1 : 0, refundDigest, gradeJob, Date.now(), r.id).run();
      await recordGrade(db, pats, correct);
      graded.push({ ruling: r.id, market: marketId, correct, refund: refundDigest });
    }
    // The resolution becomes case law, once per market, when a live ruling preceded it,
    // and each of its wording patterns gets a new memory version with the updated evidence.
    const already = await db.prepare("SELECT 1 FROM memory_jobs WHERE kind = 'precedent' AND ref = ?").bind(g.id).first();
    if (!live.length || already) continue;
    try {
      const pats = tagMarket(g.question, g.description);
      const text = precedentText({ market: g.id, question: g.question, closed: g.closedTime, pattern: pats, wording: g.description.slice(0, 220), source: g.resolutionSource || "per rules", crowdBefore: rulings[0].crowd_yes, uma: g.uma, outcome, disputed });
      const job = await rememberAsync("PRECEDENTS", NS.precedents, text);
      await trackJob(db, job, "PRECEDENTS", NS.precedents, "precedent", g.id);
      const prev = live[live.length - 1];
      await db.prepare("INSERT INTO changes (market, question, old_ruling, old_verdict, new_ruling, new_verdict, cause_blob, cause, at) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?)")
        .bind(g.id, g.question, prev.blob_id ?? prev.id, prev.verdict, `job:${job}`, `resolved ${outcome}${disputed ? " after a dispute" : ""}`, Date.now()).run();
      for (const tag of pats) await bumpPattern(db, tag, disputed);
    } catch (err) { log.error("precedent.write_failed", err, { market: marketId }); }
  }
  return { graded };
}

export async function marketFor(ref: string) { return loadMarket(ref); }
export { fields };

interface PatternState { disputed: number; total: number; firstSeen: string; latest: string }

/**
 * Adds one graded market to a wording pattern's evidence and writes the new
 * PATTERN memory version, which names the version it supersedes. Recall reads
 * the most recent version, so later rulings see the updated counts.
 */
export async function bumpPattern(db: D1Database, tag: string, disputed: boolean) {
  const row = await db.prepare("SELECT v FROM kv WHERE k = ?").bind(`pattern:${tag}`).first<{ v: string }>();
  if (!row) return null; // not initialised from the seed (see POST /api/admin/patterns)
  const st = JSON.parse(row.v) as PatternState;
  const next: PatternState = { ...st, disputed: st.disputed + (disputed ? 1 : 0), total: st.total + 1 };
  const text = patternText({ tag, rule: `${patternRule(tag)} Evidence updated by a graded market.`, disputed: next.disputed, total: next.total, firstSeen: st.firstSeen, supersedes: st.latest });
  const job = await rememberAsync("PRECEDENTS", NS.patterns, text);
  await trackJob(db, job, "PRECEDENTS", NS.patterns, "pattern", tag);
  next.latest = `job:${job}`;
  await db.prepare("UPDATE kv SET v = ?, updated_at = ? WHERE k = ?").bind(JSON.stringify(next), Date.now(), `pattern:${tag}`).run();
  return { tag, ...next, job };
}
