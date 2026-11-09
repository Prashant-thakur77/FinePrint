/**
 * Phase 2 check: precedents are recallable from Walrus Memory on mainnet.
 * Lists the PRECEDENTS account's memories, runs one recall per seeded
 * precedent (sampled) by its own question, and checks the MSTR twin comes
 * back for "sells any Bitcoin by date confirmation".
 *
 *   npx tsx scripts/check_recall.ts [sample=60]
 */
import "dotenv/config";
import { listAll, recall } from "../src/memory/client.js";
import { fields, NS } from "../src/memory/types.js";
import { readJson, RESULTS, rng, shuffle, writeJson } from "../eval/lib.js";

const sample = Number(process.argv[2] ?? 60);
const log = readJson<{ kind: string; ref: string; blobId: string; text: string; status: string }[]>(new URL("seed_log.json", RESULTS), []).filter((e) => e.kind === "precedent" && e.status === "done");
const listed = await listAll("PRECEDENTS", NS.precedents);
const listedIds = new Set(listed.map((m) => m.blobId));
const seededListed = log.filter((e) => listedIds.has(e.blobId)).length;

const picks = shuffle(log, rng(21)).slice(0, sample);
let found = 0;
for (const e of picks) {
  const q = fields(e.text).q ?? e.text.slice(0, 120);
  const hits = await recall("PRECEDENTS", NS.precedents, q, 5);
  if (hits.some((h) => h.blobId === e.blobId)) found++;
}
const twinHits = await recall("PRECEDENTS", NS.precedents, "sells any Bitcoin by date confirmation", 5);
const twin = log.find((e) => e.ref === "516926");
const out = {
  command: `npx tsx scripts/check_recall.ts ${sample}`,
  seeded: log.length, listedInNamespace: listed.length, seededAndListed: seededListed,
  recallSample: picks.length, recalledByOwnQuestion: found, recallRate: found / picks.length,
  estimatedRecallable: Math.round((found / picks.length) * seededListed),
  twin: { blobId: twin?.blobId, query: "sells any Bitcoin by date confirmation", rank: twinHits.findIndex((h) => h.blobId === twin?.blobId) + 1 || null, top: twinHits.slice(0, 3).map((h) => ({ blobId: h.blobId, distance: h.distance, market: fields(h.text).market })) },
};
writeJson(new URL("recall_check.json", RESULTS), out);
console.log(JSON.stringify(out, null, 2));
