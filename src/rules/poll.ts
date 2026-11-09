/**
 * Rule-version feed. On every poll, each watched market's rules are hashed;
 * the first sight and every real change become a RULES memory in the USER
 * account's per-market namespace, with the version history indexed in D1.
 */
import { loadMarket } from "../market.js";
import { rememberAsync } from "../memory/client.js";
import { NS, rulesText } from "../memory/types.js";
import { log } from "../log.js";
import { rulesHash } from "./snapshot.js";
import { blockAt, blockTime, bulletinUpdates } from "../tatum/polygon.js";

export async function recordVersion(db: D1Database, market: { id: string; conditionId: string; question: string; rules: string }, source: string, seenAt = Date.now()) {
  const hash = rulesHash(market.question, market.rules);
  const last = await db.prepare("SELECT n, hash FROM rule_versions WHERE market = ? ORDER BY n DESC LIMIT 1").bind(market.id).first<{ n: number; hash: string }>();
  if (last?.hash === hash) return null;
  const n = (last?.n ?? 0) + 1;
  const text = `${market.question}\n${market.rules}`;
  let jobId: string | null = null;
  try {
    jobId = await rememberAsync("USER", NS.rules(market.conditionId || market.id), rulesText({ n, market: market.id, seen: new Date(seenAt).toISOString(), hash, text }));
    await db.prepare("INSERT OR IGNORE INTO memory_jobs (job_id, account, namespace, kind, ref, status, created_at) VALUES (?, 'USER', ?, 'rules', ?, 'pending', ?)").bind(jobId, NS.rules(market.conditionId || market.id), `${market.id}#${n}`, Date.now()).run();
  } catch (err) { log.error("rules.memory_failed", err, { market: market.id }); }
  await db.prepare("INSERT INTO rule_versions (market, n, hash, seen, text, job_id, source) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(market.id, n, hash, seenAt, text, jobId, source).run();
  return { n, hash, jobId };
}

export async function snapshotRules(db: D1Database, max = 15) {
  const watched = (await db.prepare("SELECT market FROM watch WHERE ends_at IS NULL OR ends_at > ? ORDER BY added_at DESC LIMIT ?").bind(Date.now() - 7 * 86_400_000, max).all<{ market: string }>()).results;
  const changed: { market: string; n: number }[] = [];
  for (const w of watched) {
    try {
      const m = await loadMarket(w.market);
      const v = await recordVersion(db, m, `poll:${m.rulesSource}`);
      if (v) changed.push({ market: m.id, n: v.n });
    } catch (err) { log.warn("rules.poll_failed", { market: w.market, error: (err as Error).message.slice(0, 120) }); }
  }
  return { checked: watched.length, changed };
}

/**
 * A market's rule lineage from the chain: v1 is the rules as created, and each
 * later version appends one AncillaryDataUpdated bulletin-board post, dated by
 * its Polygon block. Read through Tatum's Polygon RPC. Runs locally (the block
 * range is too large for one Worker request); the Worker records the result.
 */
export async function lineageFromChain(market: { questionId: string; rules: string; createdAt: string | null; closedTime: string | null }) {
  if (!market.questionId) throw new Error("market has no UMA question id");
  const from = await blockAt(Math.floor(Date.parse(market.createdAt ?? "2024-01-01") / 1000));
  const to = await blockAt(Math.floor(Date.parse(market.closedTime ?? new Date().toISOString()) / 1000) + 86_400);
  const updates = (await bulletinUpdates(market.questionId, from, to)).sort((a, b) => a.block - b.block);
  const versions: { seen: number; rules: string; source: string }[] = [{ seen: Date.parse(market.createdAt ?? new Date().toISOString()), rules: market.rules, source: "gamma:created" }];
  let text = market.rules;
  for (const u of updates) {
    const at = (await blockTime(u.block)) * 1000;
    text = `${text}\n\nUpdate ${new Date(at).toISOString()}: ${u.text}`;
    versions.push({ seen: at, rules: text, source: `polygon:AncillaryDataUpdated tx ${u.tx} block ${u.block} owner ${u.owner}` });
  }
  return { range: [from, to], updates: updates.length, versions };
}

/** Records a precomputed lineage (from lineageFromChain) for a market that has none yet. */
export async function recordLineage(db: D1Database, market: { id: string; conditionId: string; question: string }, versions: { seen: number; rules: string; source: string }[]) {
  const existing = await db.prepare("SELECT COUNT(*) AS n FROM rule_versions WHERE market = ?").bind(market.id).first<{ n: number }>();
  if (existing?.n) return { skipped: true, versions: existing.n };
  const added = [];
  for (const v of versions) {
    const r = await recordVersion(db, { ...market, rules: v.rules }, v.source, v.seen);
    if (r) added.push({ n: r.n, seen: new Date(v.seen).toISOString(), jobId: r.jobId });
  }
  return { skipped: false, added };
}
