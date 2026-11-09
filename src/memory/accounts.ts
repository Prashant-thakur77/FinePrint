/**
 * MemWal account setup, done once from scripts/create_accounts.ts.
 *
 * Each account is owned by its own Ed25519 key (one account per address is a
 * contract rule). Gas is sponsored by the Walrus Memory relayer, the same way
 * the memory.walrus.xyz playground creates accounts: we send the transaction
 * kind with a signed sponsor authorization to POST /sponsor, sign the
 * sponsored bytes it returns, and submit them through POST /sponsor/execute.
 * The owner keys never hold SUI and nothing is spent. Object inputs are
 * resolved through Tatum's Sui gateway. Delegate keys are derived from
 * DELEGATE_KEY_SEED, so they can be rebuilt from .env.
 */
import { createHmac } from "node:crypto";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { toBase64, fromBase64 } from "@mysten/sui/utils";
import { createSponsorAuthorization } from "@mysten-incubation/memwal";
import { config } from "../config.js";
import { tatumSui } from "../tatum/sui.js";

const CLOCK = "0x6";

export function delegateFor(accountId: string, index = 0): Ed25519Keypair {
  const seed = process.env.DELEGATE_KEY_SEED;
  if (!seed) throw new Error("DELEGATE_KEY_SEED is not configured");
  const bytes = createHmac("sha256", seed).update(`memwal-delegate:${accountId.toLowerCase()}:${index}`).digest();
  return Ed25519Keypair.fromSecretKey(Uint8Array.from(bytes));
}

export const delegatePublicHex = (kp: Ed25519Keypair) => Buffer.from(kp.getPublicKey().toRawBytes()).toString("hex");

/** Builds a move call, has the Walrus Memory relayer sponsor its gas, signs and executes it. */
async function sponsored(owner: Ed25519Keypair, fill: (tx: Transaction) => void) {
  const tx = new Transaction();
  fill(tx);
  tx.setSender(owner.toSuiAddress());
  const kind = await tx.build({ client: tatumSui(), onlyTransactionKind: true });
  const sender = owner.toSuiAddress();
  let last = "";
  for (let attempt = 1; attempt <= 4; attempt++) {
    const auth = await createSponsorAuthorization(sender, kind, async (msg) => ({ signature: (await owner.signPersonalMessage(msg)).signature }));
    const sp = await fetch(`${config.memwalServerUrl}/sponsor`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ transactionBlockKindBytes: toBase64(kind), sender, ...auth }),
    });
    if (!sp.ok) { last = `sponsor ${sp.status}: ${(await sp.text()).slice(0, 200)}`; await new Promise((r) => setTimeout(r, 2000 * attempt)); continue; }
    const { bytes, digest } = (await sp.json()) as { bytes: string; digest: string };
    const { signature } = await owner.signTransaction(fromBase64(bytes));
    const ex = await fetch(`${config.memwalServerUrl}/sponsor/execute`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ digest, sender, signature }),
    });
    if (!ex.ok) { last = `execute ${ex.status}: ${(await ex.text()).slice(0, 200)}`; await new Promise((r) => setTimeout(r, 2000 * attempt)); continue; }
    const done = (await ex.json()) as { digest: string };
    const t = await tatumSui().waitForTransaction({ digest: done.digest, include: { effects: true, objectTypes: true } });
    const r = t.Transaction ?? t.FailedTransaction;
    if (!r?.effects?.status.success) throw new Error(`transaction ${done.digest} failed: ${JSON.stringify(r?.effects?.status).slice(0, 200)}`);
    return r;
  }
  throw new Error(`relayer sponsorship failed: ${last}`);
}

/** A call into the MemWal `account` module (create_account, add_delegate_key, remove_delegate_key). */
const accountCall = (fn: string) => `${config.memwalPackageId}::account::${fn}`;

export async function createAccount(owner: Ed25519Keypair): Promise<{ accountId: string; digest: string }> {
  const t = await sponsored(owner, (tx) => {
    tx.moveCall({ target: accountCall("create_account"), arguments: [tx.object(config.memwalRegistryId), tx.object(CLOCK)] });
  });
  const types = (t.objectTypes ?? {}) as Record<string, string>;
  const created = (t.effects?.changedObjects ?? []).filter((o) => o.idOperation === "Created").map((o) => o.objectId);
  const accountId = created.find((id) => (types[id] ?? "").includes("::account::MemWalAccount"));
  if (!accountId) throw new Error(`no MemWalAccount created in ${t.digest}`);
  return { accountId, digest: t.digest };
}

export async function addDelegate(owner: Ed25519Keypair, accountId: string, delegate: Ed25519Keypair, label: string) {
  const t = await sponsored(owner, (tx) =>
    tx.moveCall({
      target: accountCall("add_delegate_key"),
      arguments: [tx.object(accountId), tx.object(config.memwalRegistryId), tx.pure.vector("u8", Array.from(delegate.getPublicKey().toRawBytes())), tx.pure.string(label.slice(0, 32)), tx.object(CLOCK)],
    }),
  );
  return t.digest;
}

/** Removes a delegate key on-chain: the "revoke" button on the memory page. */
export async function removeDelegate(owner: Ed25519Keypair, accountId: string, delegate: Ed25519Keypair) {
  const t = await sponsored(owner, (tx) =>
    tx.moveCall({
      target: accountCall("remove_delegate_key"),
      arguments: [tx.object(accountId), tx.object(config.memwalRegistryId), tx.pure.vector("u8", Array.from(delegate.getPublicKey().toRawBytes()))],
    }),
  );
  return t.digest;
}
