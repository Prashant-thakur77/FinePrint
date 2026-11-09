/**
 * A bot's side of Fine Print: ask for a ruling, get a 402, pay 0.02 USDC on
 * Sui mainnet with a signed gasless transfer (x402 "exact"), retry, receive
 * the cited ruling.
 */
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction, coinWithBalance } from "@mysten/sui/transactions";
import { buildX402SignedPayment, X402_PAYMENT_HEADER, X402_PAYMENT_RESPONSE_HEADER, type X402Requirements } from "@suimpp/mpp/x402";
import { USDC } from "@suimpp/mpp";
import { tatumSui } from "../tatum/sui.js";

export interface PaidRuling { ruling: any; payment: { digest: string; payer: string; amount: string }; ms: { challenge: number; pay: number; total: number }; requirements: X402Requirements }

export async function buyRuling(base: string, market: string, signer: Ed25519Keypair, extra: Record<string, string> = {}): Promise<PaidRuling> {
  const q = new URLSearchParams({ market, ...extra });
  const url = `${base.replace(/\/$/, "")}/api/ruling?${q}`;
  const t0 = Date.now();
  const first = await fetch(url);
  if (first.status !== 402) throw new Error(`expected 402, got ${first.status}: ${(await first.text()).slice(0, 200)}`);
  const body = (await first.json()) as { accepts: X402Requirements[] };
  const requirements = body.accepts[0];
  const t1 = Date.now();
  const { header } = await buildX402SignedPayment({ requirements, signer });
  const paid = await fetch(url, { headers: { [X402_PAYMENT_HEADER]: header } });
  const t2 = Date.now();
  const json = (await paid.json()) as any;
  if (!paid.ok) throw new Error(`payment rejected (${paid.status}): ${JSON.stringify(json).slice(0, 300)}`);
  if (!paid.headers.get(X402_PAYMENT_RESPONSE_HEADER)) throw new Error("missing X-PAYMENT-RESPONSE header");
  return { ...json, requirements, ms: { challenge: t1 - t0, pay: t2 - t1, total: t2 - t0 } };
}

/** USDC the address can spend through x402 (its address balance) and in coin objects. */
export async function usdcBalances(address: string) {
  const b = await tatumSui().getBalance({ owner: address, coinType: USDC.type });
  const bal = b.balance as unknown as { balance: string; coinBalance?: string; addressBalance?: string };
  return { total: Number(bal.balance) / 1e6, coins: Number(bal.coinBalance ?? 0) / 1e6, address: Number(bal.addressBalance ?? 0) / 1e6 };
}

/** Moves USDC coin objects into the address balance, which x402's gasless transfer spends from. */
export async function depositToAddressBalance(signer: Ed25519Keypair, amount: number): Promise<string> {
  const raw = BigInt(Math.round(amount * 1e6));
  const tx = new Transaction();
  tx.setSender(signer.toSuiAddress());
  const coin = tx.add(coinWithBalance({ type: USDC.type, balance: raw, useGasCoin: false }));
  const bal = tx.moveCall({ target: "0x2::coin::into_balance", typeArguments: [USDC.type], arguments: [coin] });
  tx.moveCall({ target: "0x2::balance::send_funds", typeArguments: [USDC.type], arguments: [bal, tx.pure.address(signer.toSuiAddress())] });
  const res = await tatumSui().signAndExecuteTransaction({ transaction: tx, signer, include: { effects: true } });
  const t = res.Transaction ?? res.FailedTransaction;
  if (!t?.effects?.status.success) throw new Error(`deposit failed: ${JSON.stringify(t?.effects?.status ?? res).slice(0, 300)}`);
  return t.digest;
}
