/**
 * HTTP routes. Static pages are served by Workers Assets from public/;
 * everything under /api lands here.
 */
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { encodeX402Response, X402_PAYMENT_HEADER, X402_PAYMENT_RESPONSE_HEADER } from "@suimpp/mpp/x402";
import { config } from "./config.js";
import { log } from "./log.js";
import { defaultWindow, loadMarket, priceSeries } from "./market.js";
import { board, priceFor } from "./court/board.js";
import { cachedPreview, gradeOpen, issue, resolveJobs, rowToIssued, type RulingRow } from "./court/service.js";
import { tagMarket } from "./patterns/patterns.js";
import { challenge, PaymentError, settle } from "./pay/x402.js";
import { refund } from "./pay/refund.js";
import { snapshotRules } from "./rules/poll.js";
import { drainSamples, summarise } from "./tatum/latency.js";

export type Env = { DB: D1Database; ASSETS: Fetcher };
export type AppContext = { Bindings: Env };

const app = new Hono<AppContext>();
app.use("/api/*", cors({ origin: "*", exposeHeaders: [X402_PAYMENT_RESPONSE_HEADER], allowHeaders: ["content-type", X402_PAYMENT_HEADER, "authorization"] }));

/** Persist Tatum call timings after the response is sent. */
app.use("/api/*", async (c, next) => {
  await next();
  const samples = drainSamples();
  if (samples.length) {
    const p = c.env.DB.batch(samples.map((s) => c.env.DB.prepare("INSERT INTO latency (service, method, ms, ok, at) VALUES (?, ?, ?, ?, ?)").bind(s.service, s.method, s.ms, s.ok ? 1 : 0, s.at)));
    try { c.executionCtx.waitUntil(p); } catch { await p; }
  }
});

app.onError((err, c) => {
  const status = (err as { status?: number }).status;
  if (status === 404) return c.json({ error: err.message }, 404);
  log.error("http.error", err, { path: c.req.path });
  return c.json({ error: "internal error" }, 500);
});

app.get("/api/health", (c) => c.json({ ok: true, service: "fineprint", at: new Date().toISOString() }));

/** Cron and admin routes require the shared secret. */
export function authorised(header: string | undefined): boolean {
  const secret = config.cronSecret;
  return Boolean(secret) && header === `Bearer ${secret}`;
}

// Soft per-IP limit on routes that cost an LLM call.
const hits = new Map<string, number[]>();
function limited(c: Context<AppContext>, max = 8): boolean {
  const ip = c.req.header("cf-connecting-ip") ?? "local";
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > max;
}

async function rulingsFor(db: D1Database, market: string) {
  const rows = (await db.prepare("SELECT * FROM rulings WHERE market = ? AND level != 'rules' ORDER BY at DESC LIMIT 20").bind(market).all<RulingRow>()).results;
  return rows.map(rowToIssued);
}

app.get("/api/market/:ref", async (c) => {
  const m = await loadMarket(c.req.param("ref"));
  const [from, to] = defaultWindow(m);
  const qFrom = Number(c.req.query("from")), qTo = Number(c.req.query("to"));
  const chart = await priceSeries(m, qFrom || from, qTo || to);
  const versions = (await c.env.DB.prepare("SELECT n, hash, seen, text, blob_id, job_id, source FROM rule_versions WHERE market = ? ORDER BY n").bind(m.id).all()).results;
  return c.json({ market: m, patterns: tagMarket(m.question, m.rules), chart, rulings: await rulingsFor(c.env.DB, m.id), versions });
});

/** UI preview: same pipeline, not sold. memory=off is the kill switch (rule text only). */
app.get("/api/ruling/free/:ref", async (c) => {
  const m = await loadMarket(c.req.param("ref"));
  const level = c.req.query("memory") === "off" ? "rules" : "patterns";
  const cached = await cachedPreview(c.env.DB, m.id, level);
  if (cached) return c.json({ ruling: cached });
  if (limited(c)) return c.json({ error: "Too many previews from your network. Try again in a minute." }, 429);
  return c.json({ ruling: await issue(c.env.DB, m, level, null) });
});

/** The paid court endpoint for bots: x402 over Sui mainnet USDC. */
app.get("/api/ruling", async (c) => {
  const ref = c.req.query("market");
  if (!ref) return c.json({ error: "market query parameter is required" }, 400);
  const m = await loadMarket(ref);
  const patterns = tagMarket(m.question, m.rules);
  const header = c.req.header(X402_PAYMENT_HEADER);
  if (!header) {
    const { price, pattern } = await priceFor(c.env.DB, patterns);
    const resource = `${new URL(c.req.url).origin}/api/ruling?market=${m.id}`;
    const req = await challenge(c.env.DB, m.id, price.toFixed(3), resource);
    return c.json({ x402Version: 1, error: "payment required", accepts: [req], pricing: { pattern, priceUsdc: price } }, 402);
  }
  let paid;
  try { paid = await settle(c.env.DB, header, m.id); } catch (err) {
    if (err instanceof PaymentError) return c.json({ x402Version: 1, error: err.message }, 402);
    throw err;
  }
  try {
    const crowd = Number(c.req.query("yes"));
    const ruling = await issue(c.env.DB, m, "patterns", { price: Number(paid.amount), payer: paid.payer, digest: paid.digest }, Number.isFinite(crowd) && crowd > 0 ? crowd : null);
    c.header(X402_PAYMENT_RESPONSE_HEADER, encodeX402Response({ success: true, network: "sui:mainnet", transaction: paid.digest, payer: paid.payer }));
    return c.json({ ruling, payment: paid });
  } catch (err) {
    // Settle-then-serve: no ruling, no charge.
    log.error("ruling.after_payment_failed", err, { digest: paid.digest });
    let refundDigest: string | null = null;
    try { refundDigest = await refund(paid.payer, paid.amount); } catch (e) { log.error("refund.failed", e, { digest: paid.digest }); }
    return c.json({ error: "ruling failed after payment; refunded", refund: refundDigest }, 500);
  }
});

app.get("/api/board", async (c) => c.json({ board: await board(c.env.DB), base: config.rulingPriceUsdc }));

app.get("/api/changes", async (c) => {
  const rows = (await c.env.DB.prepare("SELECT * FROM changes ORDER BY at DESC LIMIT 30").all()).results;
  return c.json({ changes: rows });
});

app.get("/api/court/feed", async (c) => {
  const db = c.env.DB;
  const payments = (await db.prepare("SELECT p.digest, p.payer, p.amount, p.market, p.at, r.verdict, r.question, r.blob_id, r.job_id, r.status, r.correct, r.refund_digest FROM payments p LEFT JOIN rulings r ON r.id = p.ruling_id ORDER BY p.at DESC LIMIT 50").all()).results;
  const refunds = (await db.prepare("SELECT id, market, question, verdict, payer, price, refund_digest, outcome, disputed, graded_at FROM rulings WHERE refund_digest IS NOT NULL ORDER BY graded_at DESC LIMIT 30").all()).results;
  const rulings = (await db.prepare("SELECT * FROM rulings WHERE level != 'rules' ORDER BY at DESC LIMIT 30").all<RulingRow>()).results.map((r) => ({ ...rowToIssued(r), status: r.status, outcome: r.outcome, correct: r.correct, refund: r.refund_digest, gradeBlob: r.grade_blob_id }));
  return c.json({ payments, refunds, rulings });
});

app.get("/api/proof", async (c) => {
  const db = c.env.DB;
  const one = async (sql: string) => Object.values((await db.prepare(sql).first()) ?? {})[0];
  const [paid, usdc, refunds, graded, correct, rulings] = await Promise.all([
    one("SELECT COUNT(*) FROM payments"), one("SELECT COALESCE(SUM(CAST(amount AS REAL)), 0) FROM payments"),
    one("SELECT COUNT(*) FROM rulings WHERE refund_digest IS NOT NULL"), one("SELECT COUNT(*) FROM rulings WHERE status = 'graded'"),
    one("SELECT COUNT(*) FROM rulings WHERE correct = 1"), one("SELECT COUNT(*) FROM rulings WHERE level != 'rules'"),
  ]);
  const jobs = (await db.prepare("SELECT kind, account, namespace, status, COUNT(*) AS n FROM memory_jobs GROUP BY kind, account, namespace, status").all()).results;
  const recentBlobs = (await db.prepare("SELECT kind, namespace, blob_id, job_id, done_at FROM memory_jobs WHERE status = 'done' ORDER BY done_at DESC LIMIT 40").all()).results;
  const digests = (await db.prepare("SELECT digest, payer, amount, market, at FROM payments ORDER BY at DESC LIMIT 40").all()).results;
  const lat = (await db.prepare("SELECT service, method, ms, ok, at FROM latency WHERE at > ? ORDER BY at DESC LIMIT 3000").bind(Date.now() - 7 * 86_400_000).all<{ service: string; method: string; ms: number; ok: number; at: number }>()).results;
  return c.json({
    live: { rulingsSealed: rulings, paidRulings: paid, usdcReceived: usdc, rulingsGraded: graded, gradedCorrect: correct, refunds },
    memoryJobs: jobs, recentBlobs, digests,
    latency: summarise(lat.map((l) => ({ ...l, ok: Boolean(l.ok) }))),
    accounts: { server: config.serverAddress },
  });
});

app.get("/api/versions/:ref", async (c) => {
  const m = await loadMarket(c.req.param("ref"));
  const rows = (await c.env.DB.prepare("SELECT * FROM rule_versions WHERE market = ? ORDER BY n").bind(m.id).all()).results;
  return c.json({ market: m.id, versions: rows });
});

app.post("/api/watch/:ref", async (c) => {
  if (!authorised(c.req.header("authorization"))) return c.json({ error: "unauthorised" }, 401);
  const m = await loadMarket(c.req.param("ref"));
  await c.env.DB.prepare("INSERT OR REPLACE INTO watch (market, question, ends_at, added_at) VALUES (?, ?, ?, ?)").bind(m.id, m.question, m.endDate ? Date.parse(m.endDate) : null, Date.now()).run();
  return c.json({ ok: true, market: m.id });
});

export async function runCron(env: Env, which: "poll" | "grade" | "all" = "all") {
  const out: Record<string, unknown> = {};
  if (which !== "grade") {
    out.jobs = await resolveJobs(env.DB);
    out.rules = await snapshotRules(env.DB);
  }
  if (which !== "poll") out.grade = await gradeOpen(env.DB);
  return out;
}

app.post("/api/cron/:which", async (c) => {
  if (!authorised(c.req.header("authorization"))) return c.json({ error: "unauthorised" }, 401);
  const which = c.req.param("which");
  if (which !== "poll" && which !== "grade") return c.json({ error: "unknown job" }, 404);
  return c.json(await runCron(c.env, which));
});

export default app;
