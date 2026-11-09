/**
 * Creates Fine Print's three MemWal accounts on Sui mainnet and registers
 * delegate keys on each, all gas-sponsored by the server wallet through Tatum
 * gRPC. Idempotent: accounts already in .env are reused, delegate keys already
 * registered are skipped. Prints account ids and delegate public keys only.
 *
 *   npx tsx scripts/create_accounts.ts [keysPerAccount=3]
 */
import "dotenv/config";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { addDelegate, createAccount, delegateFor, delegatePublicHex } from "../src/memory/accounts.js";
import { setEnv } from "./lib/envfile.js";

const NAMES = ["PRECEDENTS", "COURT", "USER"] as const;
const perAccount = Number(process.argv[2] ?? 3);

for (const name of NAMES) {
  let ownerKey = process.env[`MEMWAL_OWNER_${name}`];
  if (!ownerKey) {
    ownerKey = Ed25519Keypair.generate().getSecretKey();
    setEnv({ [`MEMWAL_OWNER_${name}`]: ownerKey });
  }
  const owner = Ed25519Keypair.fromSecretKey(ownerKey);

  let accountId = process.env[`MEMWAL_ACCOUNT_ID_${name}`];
  if (!accountId) {
    const r = await createAccount(owner);
    accountId = r.accountId;
    setEnv({ [`MEMWAL_ACCOUNT_ID_${name}`]: accountId });
    console.log(`${name}: created account ${accountId} (tx ${r.digest})`);
  } else {
    console.log(`${name}: account ${accountId} (existing)`);
  }

  const registered = (process.env[`MEMWAL_DELEGATES_${name}`] ?? "").split(",").filter(Boolean);
  for (let i = 0; i < perAccount; i++) {
    const kp = delegateFor(accountId, i);
    const pub = delegatePublicHex(kp);
    const envName = i === 0 ? `MEMWAL_KEY_${name}` : `MEMWAL_KEY_${name}_${i}`;
    if (!registered.includes(pub)) {
      const digest = await addDelegate(owner, accountId, kp, `fineprint-${name.toLowerCase()}-${i}`);
      registered.push(pub);
      console.log(`  delegate ${i}: ${pub} (tx ${digest})`);
    } else {
      console.log(`  delegate ${i}: ${pub} (existing)`);
    }
    setEnv({ [envName]: kp.getSecretKey(), [`MEMWAL_DELEGATES_${name}`]: registered.join(",") });
  }
}

