/**
 * MemWal account setup, done once from scripts/create_accounts.ts.
 *
 * Each account is owned by its own Ed25519 key (one account per address is a
 * contract rule). The server wallet pays the gas through a sponsored
 * transaction, so the owner keys never hold SUI. Delegate keys are derived
 * from DELEGATE_KEY_SEED, so they can be rebuilt but never need to be stored
 * anywhere except .env.
 *
 * Every transaction goes through Tatum's Sui gRPC gateway.
 */
import { createHmac } from "node:crypto";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { config } from "../config.js";
import { tatumSui } from "../tatum/sui.js";

const CLOCK = "0x6";
const GAS_BUDGET = 20_000_000;

export function delegateFor(accountId: string, index = 0): Ed25519Keypair {
  const seed = process.env.DELEGATE_KEY_SEED;
  if (!seed) throw new Error("DELEGATE_KEY_SEED is not configured");
  const bytes = createHmac("sha256", seed).update(`memwal-delegate:${accountId.toLowerCase()}:${index}`).digest();
  return Ed25519Keypair.fromSecretKey(Uint8Array.from(bytes));
}

export const delegatePublicHex = (kp: Ed25519Keypair) => Buffer.from(kp.getPublicKey().toRawBytes()).toString("hex");

/** Builds, co-signs (owner + sponsor) and executes one move call. Returns the digest and created objects. */
async function sponsored(owner: Ed25519Keypair, fill: (tx: Transaction) => void) {
  const client = tatumSui();
  const sponsor = Ed25519Keypair.fromSecretKey(config.serverKey);
  const tx = new Transaction();
  fill(tx);
  tx.setSender(owner.toSuiAddress());
  tx.setGasOwner(sponsor.toSuiAddress());
  tx.setGasBudget(GAS_BUDGET);
  const bytes = await tx.build({ client });
  const [a, b] = await Promise.all([owner.signTransaction(bytes), sponsor.signTransaction(bytes)]);
  const res = await client.executeTransaction({ transaction: bytes, signatures: [a.signature, b.signature], include: { effects: true, objectTypes: true } });
  const t = res.Transaction ?? res.FailedTransaction;
  if (!t || !t.effects?.status.success) throw new Error(`transaction failed: ${JSON.stringify(t?.effects?.status ?? res).slice(0, 300)}`);
  await client.waitForTransaction({ digest: t.digest });
  return t;
}

export async function createAccount(owner: Ed25519Keypair): Promise<{ accountId: string; digest: string }> {
  const t = await sponsored(owner, (tx) =>
    tx.moveCall({ target: `${config.memwalPackageId}::account::create_account`, arguments: [tx.object(config.memwalRegistryId), tx.object(CLOCK)] }),
  );
  const types = (t.objectTypes ?? {}) as Record<string, string>;
  const created = (t.effects?.changedObjects ?? []).filter((o) => o.idOperation === "Created").map((o) => o.objectId);
  const accountId = created.find((id) => (types[id] ?? "").includes("::account::MemWalAccount"));
  if (!accountId) throw new Error(`no MemWalAccount created in ${t.digest}`);
  return { accountId, digest: t.digest };
}

export async function addDelegate(owner: Ed25519Keypair, accountId: string, delegate: Ed25519Keypair, label: string) {
  const t = await sponsored(owner, (tx) =>
    tx.moveCall({
      target: `${config.memwalPackageId}::account::add_delegate_key`,
      arguments: [tx.object(accountId), tx.object(config.memwalRegistryId), tx.pure.vector("u8", Array.from(delegate.getPublicKey().toRawBytes())), tx.pure.string(label.slice(0, 32)), tx.object(CLOCK)],
    }),
  );
  return t.digest;
}

/** Removes a delegate key on-chain: the "revoke" button on the memory page. */
export async function removeDelegate(owner: Ed25519Keypair, accountId: string, delegate: Ed25519Keypair) {
  const t = await sponsored(owner, (tx) =>
    tx.moveCall({
      target: `${config.memwalPackageId}::account::remove_delegate_key`,
      arguments: [tx.object(accountId), tx.object(config.memwalRegistryId), tx.pure.vector("u8", Array.from(delegate.getPublicKey().toRawBytes()))],
    }),
  );
  return t.digest;
}
