/**
 * USDC refunds on Sui (the payment network). Payments land in the server's address balance
 * (x402 uses send_funds), so a refund withdraws from that balance and sends
 * it back to the payer. The server wallet pays gas in SUI. Sent through
 * Tatum's Sui gateway.
 */
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { config } from "../config.js";
import { payCurrency, paySui } from "./network.js";
import { timed } from "../tatum/latency.js";

export async function sendUsdc(to: string, amount: string, signerKey = config.serverKey): Promise<string> {
  const signer = Ed25519Keypair.fromSecretKey(signerKey);
  const USDC = payCurrency();
  const raw = BigInt(Math.round(Number(amount) * 10 ** USDC.decimals));
  const tx = new Transaction();
  tx.setSender(signer.toSuiAddress());
  const [bal] = tx.moveCall({ target: "0x2::balance::redeem_funds", typeArguments: [USDC.type], arguments: [tx.withdrawal({ amount: raw, type: USDC.type })] });
  tx.moveCall({ target: "0x2::balance::send_funds", typeArguments: [USDC.type], arguments: [bal, tx.pure.address(to)] });
  const client = paySui();
  const res = await timed("tatum.sui", "ExecuteTransaction", () => client.signAndExecuteTransaction({ transaction: tx, signer, include: { effects: true } }));
  const t = res.Transaction ?? res.FailedTransaction;
  if (!t?.effects?.status.success) throw new Error(`refund failed: ${JSON.stringify(t?.effects?.status ?? res).slice(0, 200)}`);
  return t.digest;
}

export const refund = (payer: string, amount: string) => sendUsdc(payer, amount);
