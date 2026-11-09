/**
 * The ruling pipeline: market → recall precedents and patterns from Walrus
 * Memory → judge → seal the ruling as a memory before the market resolves.
 *
 * Leakage guard: `asOf` drops every precedent whose market closed at or after
 * that time, so a replay of 1 June 2026 only sees case law that existed then.
 */
import { fields, NS, rulingText, type Ruling, type Verdict } from "../memory/types.js";
import { recall, rememberAsync, type Memory } from "../memory/client.js";
import { tagMarket } from "../patterns/patterns.js";
import { judge, type Evidence, type Judgement, type Level } from "./judge.js";

export interface MarketView { id: string; question: string; rules: string; createdAt?: string | null }

export interface RulingResult extends Judgement {
  market: string; question: string; level: Level; patterns: string[];
  precedents: (Evidence & { market: string; closed: string; disputed: boolean; distance: number })[];
  patternEvidence: Evidence[];
  asOf: string | null;
}

export interface RecallOpts { asOf?: string | null; k?: number; excludeMarket?: string }

/** Precedents closest in wording, restricted to markets that closed before `asOf`. */
export async function recallPrecedents(m: MarketView, opts: RecallOpts = {}): Promise<RulingResult["precedents"]> {
  const query = `${m.question}\n${m.rules.slice(0, 600)}`;
  const hits = await recall("PRECEDENTS", NS.precedents, query, 40);
  return filterPrecedents(hits, { ...opts, excludeMarket: opts.excludeMarket ?? m.id });
}

export function filterPrecedents(hits: Memory[], opts: RecallOpts): RulingResult["precedents"] {
  const cutoff = opts.asOf ? opts.asOf.slice(0, 10) : null;
  const seen = new Set<string>();
  const out: RulingResult["precedents"] = [];
  for (const h of hits.sort((a, b) => a.distance - b.distance)) {
    const f = fields(h.text);
    if (f.kind !== "PRECEDENT" || !f.market || seen.has(f.market)) continue;
    if (opts.excludeMarket && f.market === opts.excludeMarket) continue;
    if (cutoff && !(f.closed && f.closed < cutoff)) continue;
    seen.add(f.market);
    out.push({ blobId: h.blobId, text: h.text, market: f.market, closed: f.closed, disputed: f.disputed === "true", distance: h.distance });
    if (out.length >= (opts.k ?? 8)) break;
  }
  return out;
}

/** Latest pattern memory per tag (a newer version supersedes the older one). */
export async function recallPatterns(tags: string[]): Promise<Evidence[]> {
  if (!tags.length) return [];
  const hits = await recall("PRECEDENTS", NS.patterns, `wording patterns: ${tags.join(", ")}`, 30, { sort: "recent" });
  const latest = new Map<string, Memory>();
  for (const h of hits) {
    const f = fields(h.text);
    const tag = f.tag;
    if (f.kind === "PATTERN" && tag && tags.includes(tag) && !latest.has(tag)) latest.set(tag, h);
  }
  return [...latest.values()].map((h) => ({ blobId: h.blobId, text: h.text }));
}

export async function rule(m: MarketView, level: Level, opts: RecallOpts & { track?: (tags: string[]) => Promise<{ pattern: string; correct: number; total: number }[]> } = {}): Promise<RulingResult> {
  const patterns = tagMarket(m.question, m.rules);
  const precedents = level === "rules" ? [] : await recallPrecedents(m, opts);
  const patternEvidence = level === "patterns" ? await recallPatterns(patterns) : [];
  const track = level === "patterns" && opts.track ? await opts.track(patterns) : [];
  const j = await judge({ title: m.question, rules: m.rules, level, precedents, patterns: patternEvidence, track });
  return { ...j, market: m.id, question: m.question, level, patterns, precedents, patternEvidence, asOf: opts.asOf ?? null };
}

/** Writes the ruling to the COURT account before the outcome is known. Returns the relayer job id. */
export async function seal(r: RulingResult, sale: { price: number; payer: string; digest: string }): Promise<{ jobId: string; text: string }> {
  const record: Ruling = {
    market: r.market, at: new Date().toISOString(), verdict: r.verdict as Verdict, pattern: r.patterns, cites: r.cites,
    pricePaid: sale.price, payer: sale.payer, digest: sale.digest, reason: r.reasons[0] ?? "",
  };
  const text = rulingText(record);
  return { jobId: await rememberAsync("COURT", NS.rulings, text), text };
}
