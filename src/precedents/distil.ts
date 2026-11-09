/**
 * Distils a resolved market into one PRECEDENT memory: the riskiest rule
 * clause, the resolution source, the crowd's YES price 24 hours before close,
 * the UMA status sequence, the outcome and whether it was disputed.
 */
import { clobHistory } from "../polymarket/gamma.js";
import { keyClause, PATTERNS, tagMarket } from "../patterns/patterns.js";
import { precedentText, type Precedent } from "../memory/types.js";

export interface ResolvedMarket {
  id: string; question: string; rules: string; tokens: string[]; closedTime: string; outcome: string; uma: string[]; disputed: boolean;
}

export async function crowdBefore(m: ResolvedMarket, hoursBefore = 24): Promise<number | null> {
  if (!m.tokens[0]) return null;
  const close = Math.floor(Date.parse(m.closedTime) / 1000);
  const at = close - hoursBefore * 3600;
  try {
    const pts = await clobHistory(m.tokens[0], at - 6 * 3600, at + 3600, 60);
    const before = pts.filter((p) => p.t <= at);
    return (before[before.length - 1] ?? pts[0])?.p ?? null;
  } catch { return null; }
}

function sourceOf(rules: string): string {
  const m = /(?:primary )?resolution source[^.]*?(?:will be|is)\s+([^.]{3,160})/i.exec(rules);
  return m ? m[1].trim() : "";
}

export async function distil(m: ResolvedMarket, useLlm = true): Promise<{ precedent: Precedent; text: string }> {
  const wording = useLlm ? await keyClause(m.question, m.rules).catch(() => m.rules.slice(0, 220)) : m.rules.slice(0, 220);
  const precedent: Precedent = {
    market: m.id, question: m.question, closed: m.closedTime, pattern: tagMarket(m.question, m.rules), wording,
    source: sourceOf(m.rules), crowdBefore: await crowdBefore(m), uma: m.uma, outcome: m.outcome, disputed: m.disputed,
  };
  return { precedent, text: precedentText(precedent) };
}

/** Evidence per pattern over a pool of labelled markets: how often each wording ended in a dispute. */
export function patternEvidence(pool: { question: string; rules: string; disputed: boolean }[]) {
  const stats = new Map(PATTERNS.map((p) => [p.tag, { disputed: 0, total: 0 }]));
  for (const m of pool) for (const tag of tagMarket(m.question, m.rules)) { const s = stats.get(tag)!; s.total++; if (m.disputed) s.disputed++; }
  const base = pool.length ? pool.filter((m) => m.disputed).length / pool.length : 0;
  return { base, perPattern: PATTERNS.map((p) => ({ tag: p.tag, rule: p.rule, ...stats.get(p.tag)!, rate: stats.get(p.tag)!.total ? stats.get(p.tag)!.disputed / stats.get(p.tag)!.total : 0 })) };
}
