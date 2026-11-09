/**
 * Walrus Memory clients, one per MemWal account.
 *
 * Fine Print shards its memory across three mainnet accounts:
 *   PRECEDENTS  resolved markets and learned wording patterns
 *   COURT       sealed rulings and their graded outcomes
 *   USER        the demo trader's rule versions and positions
 * Each account can hold several delegate keys. The relayer rate-limits per key
 * (about 6 remembers a minute) and per account (about 100 an hour), so bulk
 * writes rotate keys and back off on 429.
 */
import { MemWal } from "@mysten-incubation/memwal";
import { config } from "../config.js";
import { log } from "../log.js";

export type AccountName = "PRECEDENTS" | "COURT" | "USER";

export interface Memory { text: string; distance: number; blobId: string }

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const clients = new Map<string, MemWal[]>();
const cursor = new Map<string, number>();

/** All delegate keys for an account: MEMWAL_KEY_<NAME> plus optional MEMWAL_KEY_<NAME>_1.._19. */
function keysFor(name: AccountName): string[] {
  const keys = [config.account(name).key];
  for (let i = 1; i < 20; i++) {
    const k = process.env[`MEMWAL_KEY_${name}_${i}`];
    if (k) keys.push(k);
  }
  return keys.filter(Boolean);
}

export function memwalFor(name: AccountName): MemWal {
  let list = clients.get(name);
  if (!list) {
    const { accountId } = config.account(name);
    if (!accountId) throw new Error(`MEMWAL_ACCOUNT_ID_${name} is not set (run scripts/create_accounts.ts)`);
    list = keysFor(name).map((key) => MemWal.create({ key, accountId, serverUrl: config.memwalServerUrl }));
    if (!list.length) throw new Error(`MEMWAL_KEY_${name} is not set`);
    clients.set(name, list);
  }
  // Round-robin across the account's delegate keys.
  const i = (cursor.get(name) ?? 0) % list.length;
  cursor.set(name, i + 1);
  return list[i];
}

export function keyCount(name: AccountName): number {
  return keysFor(name).length;
}

/** Errors worth another try: rate limits, server errors, dropped connections, relayer job hiccups. */
const RETRYABLE = /\b(429|5\d\d)\b|Too Many Requests|rate limit|seal encrypt failed|job failed|ECONNRESET|ETIMEDOUT|fetch failed|timed out|TimeoutError/i;

/** How long the relayer asked us to wait, if it said (429 bodies carry retry_after_seconds). */
function serverBackoff(message: string): number | null {
  const hit = message.match(/retry_after_seconds\D{0,4}(\d+)/);
  return hit ? Number(hit[1]) * 1000 : null;
}

/** Runs a relayer call, retrying retryable failures with exponential backoff (or the relayer's own wait). */
export async function withRetry<T>(label: string, fn: () => Promise<T>, { tries = 4, maxWaitMs = 90_000 } = {}): Promise<T> {
  for (let n = 0; ; n++) {
    try {
      return await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (n + 1 >= tries || !RETRYABLE.test(message)) throw err;
      const waitMs = Math.min(serverBackoff(message) ?? 2 ** n * 2000, maxWaitMs);
      log.warn("memwal.retry", { op: label, attempt: n + 1, delayMs: waitMs, error: message.slice(0, 160) });
      await sleep(waitMs);
    }
  }
}

const toMemory = (r: { blob_id: string; text: string; distance: number }): Memory => ({ text: r.text, distance: r.distance, blobId: r.blob_id });

export async function recall(name: AccountName, namespace: string, query: string, limit = 10, opts: { sort?: "relevance" | "recent"; maxDistance?: number } = {}): Promise<Memory[]> {
  const r = await withRetry("recall", () => memwalFor(name).recall({ query, namespace, limit, ...opts }), { tries: 3, maxWaitMs: 5000 });
  return r.results.map(toMemory);
}

/** Submits one memory without waiting; returns the relayer job id. */
export async function rememberAsync(name: AccountName, namespace: string, text: string): Promise<string> {
  const r = await withRetry("remember", () => memwalFor(name).remember(text, namespace));
  return r.job_id;
}

/** Writes one memory and waits until it has a Walrus blob id. */
export async function rememberAndWait(name: AccountName, namespace: string, text: string, timeoutMs = 120_000) {
  const r = await withRetry("rememberAndWait", () => memwalFor(name).rememberAndWait(text, namespace, { timeoutMs, pollIntervalMs: 3000 }));
  return { blobId: r.blob_id, jobId: r.job_id ?? r.id };
}

export async function jobStatus(name: AccountName, jobId: string) {
  return memwalFor(name).getRememberStatus(jobId);
}

/** Writes up to 20 memories in one call and waits for their blob ids. */
export async function rememberBulkAndWait(name: AccountName, items: { text: string; namespace: string }[], timeoutMs = 300_000) {
  if (items.length > 20) throw new Error("rememberBulk takes at most 20 items");
  const r = await withRetry("rememberBulk", () => memwalFor(name).rememberBulkAndWait(items, { timeoutMs, pollIntervalMs: 4000 }), { tries: 5 });
  return r.results.map((x, i) => ({ text: items[i].text, status: x.status, blobId: x.blob_id, error: x.error }));
}

/** Pages through every memory the account holds in a namespace (or all namespaces). */
export async function listAll(name: AccountName, namespace?: string, max = 5000) {
  const out: { blobId: string; namespace: string; createdAt: string; status: string }[] = [];
  let cursorStr: string | undefined;
  do {
    const page = await withRetry("listMemories", () => memwalFor(name).listMemories({ cursor: cursorStr, limit: 200, namespace }));
    for (const m of page.memories) out.push({ blobId: m.blob_id, namespace: m.namespace_id, createdAt: m.created_at, status: m.status });
    cursorStr = page.has_more && page.next_cursor ? page.next_cursor : undefined;
  } while (cursorStr && out.length < max);
  return out;
}

export const walruscan = (blobId: string) => `https://walruscan.com/mainnet/blob/${blobId}`;
