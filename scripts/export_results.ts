/**
 * Publishes the measured numbers to the site: writes public/data/results.json
 * from eval/results/*.json (every value copied, none computed by hand), and
 * posts the time-machine "changed its mind" cases to the memory page.
 *
 *   npx tsx scripts/export_results.ts
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { config } from "../src/config.js";
import { DATA, readJson, RESULTS } from "../eval/lib.js";
import type { Row } from "../eval/build_dataset.js";

const load = (n: string) => readJson<any>(new URL(n, RESULTS), null);
const ds = load("dataset_summary.json"), a = load("dispute_rules.json"), b = load("dispute_precedents.json"), c = load("dispute_patterns.json");
const bot = load("bot_replay.json"), lead = load("lead_time.json"), lc = load("learning_curve.json"), blobs = load("blob_counts.json"), soak = load("soak.json"), adv = load("adversarial.json"), story = load("mstr_story.json"), pe = load("pattern_evidence.json"), rc = load("recall_check.json");
const pick = (r: any) => (r ? { accuracy: r.summary.accuracy, f1: r.summary.f1, topBucketPrecision: r.summary.topBucketPrecision, n: r.n, repeats: r.repeats, command: r.command } : null);

const out = {
  generatedAt: new Date().toISOString(), source: "eval/results/*.json via scripts/export_results.ts",
  dataset: ds && { crawledUnique: ds.crawledUnique, kept: ds.kept, pool: ds.pool, testWindow: ds.testWindow, test: { total: ds.test.total, disputed: ds.test.disputed }, crawlGapDays: ds.crawlGaps?.missingEndDateDays },
  patterns: pe && { baseRate: pe.baseRate, poolSize: pe.poolSize, top: [...pe.patterns].sort((x: any, y: any) => y.rate - x.rate).slice(0, 4) },
  recall: rc && { seeded: rc.seeded, recallRate: rc.recallRate, twinRank: rc.twin.rank },
  dispute: { model: c?.model ?? a?.model, rulesOnly: pick(a), precedents: pick(b), finePrint: pick(c) },
  botReplay: bot && { marketsWithSpike: bot.marketsWithSpike, balanced: bot.balanced, reweighted: bot.reweightedToBaseRate },
  leadTime: lead && { n: lead.disputedWithSpikeThenCliff, flagged: lead.flaggedHigh, medianLeadHours: lead.medianLeadHoursWhenFlagged, medianFlagPrice: lead.medianFlagPrice, medianCliffMinutes: lead.medianCliffMinutes },
  learning: lc && { writes: lc.writes, overall: lc.overall, perMonth: lc.perMonth },
  memory: blobs && { total: blobs.total, PRECEDENTS: blobs.PRECEDENTS?.total, COURT: blobs.COURT?.total, USER: blobs.USER?.total },
  soak: soak && { calls: soak.calls, succeeded: soak.succeeded, successRate: soak.successRate, p50ms: soak.p50ms, p95ms: soak.p95ms, network: soak.network ?? "sui:testnet" },
  adversarial: adv && { injectedRuns: adv.injectedRuns, injectedStayedHigh: adv.injectedStayedHigh, injectedCited: adv.injectedCited },
  story: story && { window: story.window1220, cliff: story.cliff, spike: story.spike },
};
writeFileSync(new URL("../public/data/results.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log("wrote public/data/results.json");

// "Changed its mind": same market, same moment, the learning arm ruled differently because of a precedent it learned during the replay.
const state = readJson<any>(new URL("learning_state.json", DATA), null);
if (state) {
  const test = readJson<Row[]>(new URL("test.json", DATA), []);
  const byId = new Map(test.map((r) => [r.id, r]));
  const written = new Map<string, any>(state.written.map((w: any) => [w.id, w]));
  const changes = state.rows.filter((r: any) => r.staticV !== r.learnV && r.learnedCites > 0 && r.learnedCite).map((r: any) => ({
    market: r.id, question: byId.get(r.id)?.question ?? r.id, old_ruling: r.staticRuling ?? "", old_verdict: r.staticV, new_ruling: r.learnRuling ?? "", new_verdict: r.learnV,
    cause_blob: r.learnedCite, cause: `learned precedent from market ${written.get(r.learnedCiteMarket)?.id ?? r.learnedCiteMarket ?? "?"}; ${r.label ? "the market was disputed" : "the market resolved cleanly"}`, at: Date.parse(r.rulingTime ?? new Date().toISOString()),
  }));
  const res = await fetch(`${process.env.FINEPRINT_URL ?? config.publicUrl}/api/admin/changes`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${config.cronSecret}` }, body: JSON.stringify({ changes }) });
  console.log("changes:", await res.text());
}
