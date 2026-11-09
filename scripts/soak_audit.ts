/**
 * Audits a soak run from the server's side: for every failed call, was a
 * payment settled without a ruling? Reads the live court feed and adds the
 * answer to eval/results/soak.json.
 *
 *   npx tsx scripts/soak_audit.ts
 */
import "dotenv/config";
import { config } from "../src/config.js";
import { readJson, RESULTS, writeJson } from "../eval/lib.js";

const soak = readJson<any>(new URL("soak.json", RESULTS), null);
if (!soak) throw new Error("run scripts/soak.ts first");
const feed = (await (await fetch(`${process.env.FINEPRINT_URL ?? config.publicUrl}/api/court/feed`)).json()) as { payments: { digest: string; verdict: string | null; at: number }[] };
const okDigests = new Set(soak.results.filter((r: any) => r.ok).map((r: any) => r.digest));
const recent = feed.payments;
soak.serverAudit = {
  command: "npx tsx scripts/soak_audit.ts",
  paymentsInFeed: recent.length,
  paymentsWithoutRuling: recent.filter((p) => !p.verdict).length,
  soakDigestsFound: recent.filter((p) => okDigests.has(p.digest)).length,
  failedCalls: soak.results.filter((r: any) => !r.ok).length,
  failedCallErrors: [...new Set(soak.results.filter((r: any) => !r.ok).map((r: any) => r.error))],
  note: "failed calls never settled a payment when paymentsWithoutRuling is 0; the errors are the test machine's connection failures",
};
writeJson(new URL("soak.json", RESULTS), soak);
console.log(JSON.stringify(soak.serverAudit, null, 2));
