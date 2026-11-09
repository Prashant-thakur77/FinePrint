/**
 * Gives the live court each wording pattern's starting evidence (counted over
 * the precedent pool) and the blob of its seeded PATTERN memory, so graded
 * markets can add evidence and write superseding versions.
 *
 *   npx tsx scripts/init_patterns.ts
 */
import "dotenv/config";
import { config } from "../src/config.js";
import { readJson, RESULTS } from "../eval/lib.js";

const ev = readJson<{ patterns: { tag: string; disputed: number; total: number }[] }>(new URL("pattern_evidence.json", RESULTS), { patterns: [] });
const seed = readJson<{ kind: string; ref: string; blobId: string; status: string }[]>(new URL("seed_log.json", RESULTS), []);
const patterns = ev.patterns.map((p) => ({ tag: p.tag, disputed: p.disputed, total: p.total, blobId: seed.find((e) => e.kind === "pattern" && e.ref === p.tag && e.status === "done")?.blobId ?? "" })).filter((p) => p.blobId);
const r = await fetch(`${process.env.FINEPRINT_URL ?? config.publicUrl}/api/admin/patterns`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${config.cronSecret}` }, body: JSON.stringify({ patterns }) });
console.log(r.status, (await r.text()).slice(0, 400));
