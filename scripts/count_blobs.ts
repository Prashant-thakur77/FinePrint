/**
 * Counts Fine Print's memories on Walrus mainnet, per account and namespace,
 * by listing them through the relayer. Writes eval/results/blob_counts.json.
 *
 *   npx tsx scripts/count_blobs.ts
 */
import "dotenv/config";
import { config } from "../src/config.js";
import { listAll } from "../src/memory/client.js";
import { RESULTS, writeJson } from "../eval/lib.js";

const out: Record<string, unknown> = { command: "npx tsx scripts/count_blobs.ts", at: new Date().toISOString() };
let total = 0;
for (const name of ["PRECEDENTS", "COURT", "USER"] as const) {
  const all = await listAll(name);
  const by: Record<string, number> = {};
  for (const m of all) { const ns = m.namespace.startsWith("rules/") ? "rules/*" : m.namespace; by[ns] = (by[ns] ?? 0) + 1; }
  total += all.length;
  out[name] = { accountId: config.account(name).accountId, total: all.length, byNamespace: by, sample: all.slice(0, 3).map((m) => m.blobId) };
  console.log(name, all.length, by);
}
out.total = total;
writeJson(new URL("blob_counts.json", RESULTS), out);
console.log(`total ${total}`);
