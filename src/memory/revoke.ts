/**
 * The revoke button. The demo trader's account (USER) carries a "guest"
 * delegate key that only this button uses. Pressing it removes that key
 * on-chain (a real sponsored transaction through Tatum gRPC), then registers
 * the next guest key so the button keeps working for the next visitor.
 * Revocation is forward-only: memories written before stay readable by the
 * removed key until re-encrypted.
 */
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { config } from "../config.js";
import { addDelegate, delegateFor, delegatePublicHex, removeDelegate } from "./accounts.js";

const GUEST_BASE = 100; // guest keys use derivation indices 100, 101, ...
const COOLDOWN_MS = 2 * 60_000;

async function getKv(db: D1Database, k: string) {
  return (await db.prepare("SELECT v, updated_at FROM kv WHERE k = ?").bind(k).first<{ v: string; updated_at: number }>()) ?? null;
}
async function setKv(db: D1Database, k: string, v: string) {
  await db.prepare("INSERT INTO kv (k, v, updated_at) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at").bind(k, v, Date.now()).run();
}

function owner() {
  const key = process.env.MEMWAL_OWNER_USER;
  if (!key) throw new Error("revoke is not configured");
  return Ed25519Keypair.fromSecretKey(key);
}

/** Registers the first guest key (run once from setup, or lazily). */
export async function ensureGuest(db: D1Database) {
  const cur = await getKv(db, "guest_index");
  if (cur) return Number(cur.v);
  const accountId = config.account("USER").accountId;
  const digest = await addDelegate(owner(), accountId, delegateFor(accountId, GUEST_BASE), "fineprint-guest-0");
  await setKv(db, "guest_index", String(GUEST_BASE));
  await setKv(db, "guest_added", digest);
  return GUEST_BASE;
}

export async function revokeGuest(db: D1Database) {
  const last = await getKv(db, "last_revoke");
  if (last && Date.now() - last.updated_at < COOLDOWN_MS) {
    const wait = Math.ceil((COOLDOWN_MS - (Date.now() - last.updated_at)) / 1000);
    throw Object.assign(new Error(`Someone just pressed it. Try again in ${wait}s.`), { status: 429 });
  }
  await setKv(db, "last_revoke", "pending");
  const accountId = config.account("USER").accountId;
  const index = await ensureGuest(db);
  const removed = delegateFor(accountId, index);
  const digest = await removeDelegate(owner(), accountId, removed);
  const next = delegateFor(accountId, index + 1);
  let nextDigest: string | null = null;
  try { nextDigest = await addDelegate(owner(), accountId, next, `fineprint-guest-${index + 1 - GUEST_BASE}`); } catch { /* the next press will retry */ }
  if (nextDigest) await setKv(db, "guest_index", String(index + 1));
  const record = { digest, removedKey: delegatePublicHex(removed), nextKey: nextDigest ? delegatePublicHex(next) : null, nextDigest, account: accountId, at: Date.now() };
  await setKv(db, "last_revoke", JSON.stringify(record));
  return record;
}

export async function lastRevoke(db: D1Database) {
  const r = await getKv(db, "last_revoke");
  try { return r && r.v !== "pending" ? JSON.parse(r.v) : null; } catch { return null; }
}
