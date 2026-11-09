/**
 * Demo buyer bot. A deliberately simple news-spike strategy: when a market's
 * YES price jumps by at least `jump` within an hour, it wants to buy YES.
 * Before buying, it pays Fine Print 0.02 USDC on Sui (PAY_NETWORK) for a ruling and
 * skips the trade when the ruling is HIGH. Trades are paper trades (logged,
 * not sent to Polymarket); the ruling payments are real.
 *
 *   npx tsx src/bot/buyer.ts watch [minutes=60]       live spike watching
 *   npx tsx src/bot/buyer.ts forward [n=30]           buy rulings on n short-dated live markets
 *   npx tsx src/bot/buyer.ts replay-mstr              the 1 June 2026 MSTR moment (asOf replay)
 */
import "dotenv/config";
import { appendFileSync, mkdirSync } from "node:fs";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { config } from "../config.js";
import { pmHistory } from "../tatum/pm.js";
import { gammaMarkets } from "../polymarket/gamma.js";
import { buyRuling } from "./client.js";
import { payExplorerTx } from "../pay/network.js";

const BASE = process.env.FINEPRINT_URL ?? config.publicUrl;
const LOG = new URL("../../eval/results/bot_log.jsonl", import.meta.url);
mkdirSync(new URL("../../eval/results/", import.meta.url), { recursive: true });
const signer = () => Ed25519Keypair.fromSecretKey(config.botKey);
const suiscan = payExplorerTx;

function record(entry: Record<string, unknown>) {
  appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
}

export async function decide(market: string, side: "YES", price: number, reason: string, extra: Record<string, string> = {}) {
  console.log(`BUY ${side} @${price.toFixed(2)}  ${reason}`);
  console.log(`  → GET /api/ruling?market=${market}  402 Payment Required`);
  const r = await buyRuling(BASE, market, signer(), { yes: price.toFixed(4), ...extra });
  console.log(`  → paid ${r.payment.amount} USDC  ${suiscan(r.payment.digest)}`);
  const v = r.ruling.verdict as string;
  const action = v === "HIGH" ? "SKIPPED" : "BOUGHT (paper)";
  const cite = r.ruling.cites?.[0];
  console.log(`  → ruling ${v} (p=${Number(r.ruling.pDispute).toFixed(2)})${cite ? ` citing market ${cite.market ?? "?"} blob ${cite.blobId}` : ""}`);
  console.log(`  → ${action}`);
  record({ market, side, price, reason, verdict: v, pDispute: r.ruling.pDispute, cites: r.ruling.cites?.map((c: any) => c.blobId), digest: r.payment.digest, amount: r.payment.amount, action, ms: r.ms, rulingId: r.ruling.id, asOf: r.ruling.asOf ?? null });
  return { verdict: v, action, digest: r.payment.digest, ms: r.ms };
}

async function spikeOf(m: { conditionId: string }, jump: number) {
  const end = new Date(), start = new Date(Date.now() - 70 * 60_000);
  const c = await pmHistory(m.conditionId, "1m", start, end);
  if (c.length < 10) return null;
  const now = c[c.length - 1].close;
  const low = Math.min(...c.map((x) => x.low));
  return now - low >= jump && now >= 0.5 && now <= 0.95 ? { now, low } : null;
}

/**
 * Live markets closing within the next hours. Discovery uses Polymarket's Gamma
 * listing (Tatum's "active" filter also returns markets whose close time has
 * passed); rules, prices and rulings then go through Tatum as usual.
 */
async function liveMarkets(hoursAhead: number, limit = 100) {
  const now = Date.now();
  const rows = await gammaMarkets({ closed: false, active: true, limit, order: "volumeNum", ascending: false, end_date_min: new Date(now + 30 * 60_000).toISOString(), end_date_max: new Date(now + hoursAhead * 3600_000).toISOString() });
  // Skip markets that are already effectively decided: a ruling there says nothing.
  return rows.filter((m) => m.conditionId && m.outcomes.length === 2 && m.description.length > 40 && m.outcomePrices.every((p) => p > 0.03 && p < 0.97)).map((m) => ({
    id: m.id, question: m.question, closeTime: m.endDate, conditionId: m.conditionId,
    outcomes: m.outcomes.map((name, i) => ({ name, price: m.outcomePrices[i] ?? 0.5 })),
  }));
}

async function watch(minutes: number, jump = 0.15) {
  const until = Date.now() + minutes * 60_000;
  const seen = new Set<string>();
  while (Date.now() < until) {
    for (const m of (await liveMarkets(72)).slice(0, 40)) {
      if (seen.has(m.id)) continue;
      try {
        const s = await spikeOf(m, jump);
        if (!s) continue;
        seen.add(m.id);
        await decide(m.id, "YES", s.now, `spike ${s.low.toFixed(2)}→${s.now.toFixed(2)} in 60m: ${m.question.slice(0, 70)}`);
      } catch (err) { console.error(`${m.id}: ${(err as Error).message.slice(0, 160)}`); }
    }
    await new Promise((r) => setTimeout(r, 60_000));
  }
}

async function forward(n: number) {
  const markets = (await liveMarkets(20, 100)).slice(0, n);
  console.log(`forward set: ${markets.length} live markets closing within 20h`);
  for (const m of markets) {
    const yes = m.outcomes.find((o) => /^yes$/i.test(o.name))?.price ?? m.outcomes[0]?.price ?? 0.5;
    // Watch it too, so the rule-version feed snapshots it every poll until it closes.
    if (config.cronSecret) await fetch(`${BASE}/api/watch/${m.id}`, { method: "POST", headers: { authorization: `Bearer ${config.cronSecret}` } }).catch(() => null);
    try { await decide(m.id, "YES", yes, `forward set: ${m.question.slice(0, 80)} (closes ${m.closeTime})`); }
    catch (err) { console.error(`${m.id}: ${(err as Error).message.slice(0, 200)}`); }
  }
}

const [mode = "forward", arg] = process.argv.slice(2);
if (mode === "watch") await watch(Number(arg ?? 60));
else if (mode === "forward") await forward(Number(arg ?? 30));
else if (mode === "replay-mstr") {
  // 1 June 2026, 12:20 UTC: YES has spiked from 12c to 81c on the 8-K. The ruling may
  // only use precedents whose market closed before this moment (asOf).
  await decide("2169995", "YES", 0.81, "replay 2026-06-01 12:20 UTC: 8-K shows 32 BTC sold", { asOf: "2026-06-01T12:20:00Z" });
} else console.error(`unknown mode ${mode}`);
