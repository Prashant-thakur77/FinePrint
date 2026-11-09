/**
 * Memory text formats. Each memory is one line of pipe-separated fields, so it
 * embeds well for semantic recall and parses back without a schema. Recall is
 * semantic only (no metadata filters), so anything we need to filter on later,
 * such as the close date for the leakage guard, lives inside the text.
 */
export const NS = {
  precedents: "precedents",
  patterns: "patterns",
  rulings: "rulings",
  track: "track",
  rules: (conditionId: string) => `rules/${conditionId.slice(0, 18)}`,
} as const;

const clean = (s: string, max = 240) => s.replace(/[|"\n\r]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

export interface Precedent {
  market: string; question: string; closed: string; pattern: string[]; wording: string; source: string;
  crowdBefore: number | null; uma: string[]; outcome: string; disputed: boolean;
}

export function precedentText(p: Precedent): string {
  return [
    "PRECEDENT", `market:${p.market}`, `q:"${clean(p.question, 160)}"`, `closed:${p.closed.slice(0, 10)}`,
    `pattern:${p.pattern.join("+") || "none"}`, `wording:"${clean(p.wording)}"`, `source:${clean(p.source, 80) || "unspecified"}`,
    `crowd_before:${p.crowdBefore == null ? "na" : p.crowdBefore.toFixed(2)}`, `uma:${p.uma.join(">") || "none"}`,
    `outcome:${p.outcome}`, `disputed:${p.disputed}`,
  ].join(" | ");
}

export interface Pattern { tag: string; rule: string; disputed: number; total: number; firstSeen: string; supersedes: string }

export function patternText(p: Pattern): string {
  return ["PATTERN", p.tag, `rule:"${clean(p.rule, 300)}"`, `evidence:${p.disputed}/${p.total}`, `first_seen:${p.firstSeen || "none"}`, `supersedes:${p.supersedes || "none"}`].join(" | ");
}

export type Verdict = "HIGH" | "MED" | "LOW";

export interface Ruling { market: string; at: string; verdict: Verdict; pattern: string[]; cites: string[]; pricePaid: number; payer: string; digest: string; reason: string }

export function rulingText(r: Ruling): string {
  return [
    "RULING", `market:${r.market}`, `at:${r.at}`, `verdict:${r.verdict}`, `pattern:${r.pattern.join("+") || "none"}`,
    `cites:${r.cites.join(",") || "none"}`, `price_paid:${r.pricePaid}`, `payer:${r.payer || "preview"}`, `digest:${r.digest || "none"}`,
    `reason:"${clean(r.reason, 200)}"`,
  ].join(" | ");
}

export interface Grade { ruling: string; market: string; verdict: Verdict; pattern: string[]; outcome: string; disputed: boolean; correct: boolean; refund: string }

export function gradeText(g: Grade): string {
  return ["GRADE", `ruling:${g.ruling}`, `market:${g.market}`, `verdict:${g.verdict}`, `pattern:${g.pattern.join("+") || "none"}`, `outcome:${g.outcome}`, `disputed:${g.disputed}`, `correct:${g.correct}`, `refund:${g.refund || "none"}`].join(" | ");
}

export function rulesText(v: { n: number; market: string; seen: string; hash: string; text: string }): string {
  return [`RULES v${v.n}`, `market:${v.market}`, `seen:${v.seen}`, `hash:${v.hash}`, `text:"${clean(v.text, 1500)}"`].join(" | ");
}

/** Parses `key:value` fields back out of any memory line. */
export function fields(text: string): Record<string, string> {
  const out: Record<string, string> = { kind: text.split(" | ")[0] };
  for (const part of text.split(" | ").slice(1)) {
    const i = part.indexOf(":");
    if (i > 0) out[part.slice(0, i)] = part.slice(i + 1).replace(/^"|"$/g, "");
    else out.tag ??= part;
  }
  return out;
}
