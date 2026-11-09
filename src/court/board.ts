/**
 * Per-pattern prices from remembered accuracy.
 *   accuracy = (correct + 1) / (total + 2)      (Laplace-smoothed, 0.5 with no history)
 *   price    = base × (0.5 + accuracy), clamped to 0.01–0.05 USDC
 * A pattern the court has called well costs more; one it keeps missing gets cheaper.
 */
import { config } from "../config.js";
import { PATTERNS } from "../patterns/patterns.js";
import { clampPrice } from "../pay/x402.js";

export interface BoardRow { pattern: string; correct: number; total: number; accuracy: number; price: number }

export const accuracyOf = (correct: number, total: number) => (correct + 1) / (total + 2);
export const priceOf = (correct: number, total: number, base = config.rulingPriceUsdc) => clampPrice(base * (0.5 + accuracyOf(correct, total)));

export async function board(db: D1Database): Promise<BoardRow[]> {
  const rows = (await db.prepare("SELECT pattern, correct, total FROM board").all<{ pattern: string; correct: number; total: number }>()).results;
  const by = new Map(rows.map((r) => [r.pattern, r]));
  return [...PATTERNS.map((p) => p.tag), "none"].map((tag) => {
    const r = by.get(tag) ?? { correct: 0, total: 0 };
    return { pattern: tag, correct: r.correct, total: r.total, accuracy: accuracyOf(r.correct, r.total), price: priceOf(r.correct, r.total) };
  });
}

/** Price for a market: the price of its best-evidenced pattern (most graded rulings), else the base price. */
export async function priceFor(db: D1Database, patterns: string[]): Promise<{ price: number; pattern: string }> {
  const b = await board(db);
  const mine = b.filter((r) => patterns.includes(r.pattern)).sort((a, z) => z.total - a.total);
  const pick = mine[0] ?? b.find((r) => r.pattern === "none")!;
  return { price: pick.price, pattern: pick.pattern };
}

export async function recordGrade(db: D1Database, patterns: string[], correct: boolean) {
  for (const p of patterns.length ? patterns : ["none"]) {
    await db.prepare(`INSERT INTO board (pattern, correct, total, price, updated_at) VALUES (?, ?, 1, ?, ?)
      ON CONFLICT(pattern) DO UPDATE SET correct = correct + excluded.correct, total = total + 1, updated_at = excluded.updated_at`)
      .bind(p, correct ? 1 : 0, "0", Date.now()).run();
  }
}

export async function trackFor(db: D1Database, patterns: string[]) {
  const b = await board(db);
  return b.filter((r) => patterns.includes(r.pattern)).map((r) => ({ pattern: r.pattern, correct: r.correct, total: r.total }));
}
