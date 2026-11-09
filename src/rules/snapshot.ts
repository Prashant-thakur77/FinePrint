/**
 * Rule versions. A market's rules (title + description) are hashed on every
 * poll; a new version is written to the USER account's per-market namespace
 * only when the words change, not when whitespace, punctuation or casing does.
 */
import { createHash } from "node:crypto";

export const normalise = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
export const rulesHash = (title: string, rules: string) => createHash("sha256").update(normalise(`${title}\n${rules}`)).digest("hex");

export interface DiffPart { op: "same" | "add" | "del"; text: string }

/** Word-level diff (LCS). Rules are short, so O(n·m) is fine. */
export function wordDiff(a: string, b: string): DiffPart[] {
  const x = a.split(/(\s+)/).filter(Boolean), y = b.split(/(\s+)/).filter(Boolean);
  const n = x.length, m = y.length;
  if (n * m > 4_000_000) return [{ op: "del", text: a }, { op: "add", text: b }];
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffPart[] = [];
  const push = (op: DiffPart["op"], text: string) => { const last = out[out.length - 1]; if (last?.op === op) last.text += text; else out.push({ op, text }); };
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) { push("same", x[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) push("del", x[i++]);
    else push("add", y[j++]);
  }
  while (i < n) push("del", x[i++]);
  while (j < m) push("add", y[j++]);
  return out;
}

/** True when two rule texts differ only cosmetically. */
export const cosmeticOnly = (a: string, b: string) => normalise(a) === normalise(b);
