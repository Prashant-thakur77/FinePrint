/**
 * Pay-per-ruling over x402 (scheme "exact", USDC on Sui; network from PAY_NETWORK).
 *
 *  1. No X-PAYMENT header → 402 with one `accepts` entry bound to a fresh,
 *     single-use challenge id (stored in D1) and the current Sui epoch.
 *  2. X-PAYMENT header → structural check against our terms, claim the
 *     challenge atomically, submit the client-signed gasless transfer through
 *     Tatum's Sui gateway, confirm the USDC balance change, record the
 *     digest (replay store), then serve.
 * Settle-then-serve: if the ruling fails after settlement, the payer is refunded.
 */
import { createX402Requirements, parseX402Header, settleX402Payment, verifyX402Payment, type X402PaymentPayload, type X402Requirements } from "@suimpp/mpp/x402";
import { config } from "../config.js";
import { payCurrency, payNetwork, paySui } from "./network.js";
import { timed } from "../tatum/latency.js";
import { chainInfo } from "./chain.js";

export const PRICE_MIN = 0.01, PRICE_MAX = 0.05;
export const clampPrice = (p: number) => Math.min(PRICE_MAX, Math.max(PRICE_MIN, Math.round(p * 1000) / 1000));

export async function challenge(db: D1Database, market: string, amount: string, resource: string): Promise<X402Requirements> {
  const id = crypto.randomUUID();
  await db.prepare("INSERT INTO challenges (id, market, amount, created_at) VALUES (?, ?, ?, ?)").bind(id, market, amount, Date.now()).run();
  const { chain, epoch } = await chainInfo();
  return createX402Requirements({ challengeId: id, amount, currency: payCurrency(), recipient: config.serverAddress, resource, network: payNetwork(), chain, currentEpoch: epoch, maxTimeoutSeconds: 120 });
}

export interface Settled { digest: string; payer: string; amount: string; market: string; challengeId: string }

export class PaymentError extends Error { constructor(msg: string, readonly status = 402) { super(msg); } }

export async function settle(db: D1Database, header: string, market: string): Promise<Settled> {
  let payment: X402PaymentPayload;
  try { payment = parseX402Header(header); } catch { throw new PaymentError("X-PAYMENT header could not be parsed"); }
  const challengeId = payment.payload.challengeId;
  const row = await db.prepare("SELECT market, amount, used_digest FROM challenges WHERE id = ?").bind(challengeId).first<{ market: string; amount: string; used_digest: string | null }>();
  if (!row) throw new PaymentError("unknown challenge");
  if (row.market !== market) throw new PaymentError("challenge was issued for a different market");
  if (row.used_digest) throw new PaymentError("challenge already used");
  const expected = { challengeId, amount: row.amount, currency: payCurrency(), recipient: config.serverAddress, network: payNetwork() };
  try { verifyX402Payment({ payment, expected }); } catch (err) { throw new PaymentError(`payment does not match the terms: ${(err as Error).message}`); }

  // Claim the challenge before touching the chain, so one challenge can never settle twice.
  const claim = await db.prepare("UPDATE challenges SET used_digest = 'settling' WHERE id = ? AND used_digest IS NULL").bind(challengeId).run();
  if (!claim.meta.changes) throw new PaymentError("challenge already used");

  const store = {
    has: async (digest: string) => Boolean(await db.prepare("SELECT 1 FROM payments WHERE digest = ?").bind(digest).first()),
    set: async (digest: string) => {
      await db.prepare("INSERT INTO payments (digest, payer, amount, market, challenge_id, verified_via, at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(digest, payment.payload.senderAddress, row.amount, market, challengeId, `tatum-graphql:${payNetwork()}`, Date.now()).run();
    },
  };
  try {
    const res = await timed("tatum.sui", "ExecuteTransaction", () => settleX402Payment({ payment, client: paySui(), store, expected }));
    await db.prepare("UPDATE challenges SET used_digest = ? WHERE id = ?").bind(res.transaction, challengeId).run();
    return { digest: res.transaction, payer: res.payer, amount: row.amount, market, challengeId };
  } catch (err) {
    await db.prepare("UPDATE challenges SET used_digest = NULL WHERE id = ? AND used_digest = 'settling'").bind(challengeId).run();
    throw new PaymentError(`settlement failed: ${(err as Error).message}`);
  }
}

/** Independent re-check of a settled digest through Tatum: success + USDC credited to us. */
export async function confirmDigest(digest: string, amount: string): Promise<boolean> {
  const tx = await timed("tatum.sui", "GetTransaction", () => paySui().getTransaction({ digest, include: { balanceChanges: true, effects: true } }));
  const t = tx.Transaction ?? tx.FailedTransaction;
  if (!t?.effects?.status.success) return false;
  const want = BigInt(Math.round(Number(amount) * 10 ** payCurrency().decimals));
  const me = config.serverAddress.toLowerCase();
  return (t.balanceChanges ?? []).some((b) => b.coinType === payCurrency().type && b.address.toLowerCase() === me && BigInt(b.amount) >= want);
}
