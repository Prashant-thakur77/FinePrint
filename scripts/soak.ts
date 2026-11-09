/**
 * Reliability: real paid calls against the deployed court endpoint. Each call
 * goes 402 → signed USDC payment on Sui (PAY_NETWORK) → settled through Tatum
 * → cited ruling. Rotates over a few live markets (so previews are not reused).
 *
 *   npx tsx scripts/soak.ts [calls=50] [concurrency=2]
 */
import "dotenv/config";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { config } from "../src/config.js";
import { buyRuling } from "../src/bot/client.js";
import { pmMarkets } from "../src/tatum/pm.js";
import { RESULTS, round, writeJson } from "../eval/lib.js";

const calls = Number(process.argv[2] ?? 50), conc = Number(process.argv[3] ?? 2);
const base = process.env.FINEPRINT_URL ?? config.publicUrl;
const bot = Ed25519Keypair.fromSecretKey(config.botKey);
const markets = (await pmMarkets({ platform: "polymarket", status: "active", sort: "volume_desc", limit: 20 })).data.filter((m) => m.chain?.conditionId).map((m) => m.id);
const results: { i: number; market: string; ok: boolean; ms: number; digest?: string; verdict?: string; cited?: boolean; error?: string }[] = [];
let next = 0;
await Promise.all(Array.from({ length: conc }, async () => {
  for (let i = next++; i < calls; i = next++) {
    const market = markets[i % markets.length];
    const t0 = Date.now();
    try {
      const r = await buyRuling(base, market, bot);
      results.push({ i, market, ok: true, ms: Date.now() - t0, digest: r.payment.digest, verdict: r.ruling.verdict, cited: (r.ruling.cites ?? []).length > 0 });
    } catch (err) { results.push({ i, market, ok: false, ms: Date.now() - t0, error: (err as Error).message.slice(0, 200) }); }
    console.log(`${i + 1}/${calls} ${results[results.length - 1].ok ? "ok" : "FAIL"} ${results[results.length - 1].ms} ms`);
  }
}));
const ok = results.filter((r) => r.ok).map((r) => r.ms).sort((a, b) => a - b);
const pct = (p: number) => ok[Math.min(ok.length - 1, Math.floor(p * ok.length))];
const out = { command: `npx tsx scripts/soak.ts ${calls} ${conc}`, endpoint: `${base}/api/ruling`, calls, succeeded: ok.length, successRate: round(ok.length / calls), p50ms: pct(0.5), p95ms: pct(0.95), usdcSpent: round(results.filter((r) => r.ok).length * config.rulingPriceUsdc, 3), results };
writeJson(new URL("soak.json", RESULTS), out);
console.log(JSON.stringify({ ...out, results: undefined }, null, 2));
