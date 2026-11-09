/**
 * Reads a market's rule lineage from Polygon (UMA adapter bulletin board,
 * through Tatum) and records it on Fine Print: one rule version per update,
 * each stored as a RULES memory on Walrus mainnet.
 *
 *   npx tsx scripts/lineage.ts 2169995
 */
import "dotenv/config";
import { config } from "../src/config.js";
import { gammaMarket } from "../src/polymarket/gamma.js";
import { lineageFromChain } from "../src/rules/poll.js";
import { RESULTS, writeJson } from "../eval/lib.js";

const id = process.argv[2] ?? "2169995";
const m = await gammaMarket(id);
const l = await lineageFromChain({ questionId: m.questionId, rules: `${m.description}`, createdAt: m.createdAt, closedTime: m.closedTime });
console.log(`blocks ${l.range[0]}..${l.range[1]}: ${l.updates} bulletin update(s)`);
for (const v of l.versions) console.log(`- ${new Date(v.seen).toISOString()}  ${v.source}`);
const r = await fetch(`${process.env.FINEPRINT_URL ?? config.publicUrl}/api/admin/lineage/${id}`, {
  method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${config.cronSecret}` }, body: JSON.stringify({ versions: l.versions }),
});
const out = await r.json();
console.log(JSON.stringify(out));
writeJson(new URL(`lineage_${id}.json`, RESULTS), { command: `npx tsx scripts/lineage.ts ${id}`, market: id, questionId: m.questionId, ...l, recorded: out });
