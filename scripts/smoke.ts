/**
 * Phase 1 smoke tests against mainnet. Each step prints real data and the
 * results go to docs/smoke.md.
 *
 *   npx tsx scripts/smoke.ts [all|pm|sui|polygon|memwal|x402]
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { addresses, config } from "../src/config.js";
import { pmHistory, pmMarket } from "../src/tatum/pm.js";
import { chainAndEpoch, tatumSui } from "../src/tatum/sui.js";
import { blockAt, bulletinUpdates, disputes } from "../src/tatum/polygon.js";
import { recall, rememberAndWait } from "../src/memory/client.js";
import { gammaMarket } from "../src/polymarket/gamma.js";
import { buyRuling, usdcBalances } from "../src/bot/client.js";
import { confirmDigest } from "../src/pay/x402.js";
import { payExplorerTx, payNetwork } from "../src/pay/network.js";
import { peekSamples, summarise } from "../src/tatum/latency.js";

const which = process.argv[2] ?? "all";
const lines: string[] = [`# Smoke tests`, ``, `Run: \`npx tsx scripts/smoke.ts ${which}\` at ${new Date().toISOString()}`, ``];
const out = (s = "") => { console.log(s); lines.push(s); };
const results: Record<string, "PASS" | "FAIL"> = {};
async function step(name: string, fn: () => Promise<void>) {
  if (which !== "all" && which !== name) return;
  out(`## ${name}`);
  try { await fn(); results[name] = "PASS"; out(`**PASS**`); } catch (err) { results[name] = "FAIL"; out(`**FAIL**: ${(err as Error).message.slice(0, 400)}`); }
  out();
}

const MSTR = "2169995";

await step("pm", async () => {
  const g = await gammaMarket(MSTR);
  const m = await pmMarket(g.conditionId);
  out(`Tatum PM \`/markets/${g.conditionId.slice(0, 12)}…\`: "${m.question}" status=${m.status} resolution=${JSON.stringify(m.resolution)}`);
  out(`Rules (first 200 chars): ${(m.description ?? "").slice(0, 200).replace(/\n/g, " ")}`);
  const c = await pmHistory(g.conditionId, "1m", new Date("2026-06-01T11:00:00Z"), new Date("2026-06-01T17:30:00Z"));
  const at = (hhmm: string) => c.find((x) => x.timestamp.slice(11, 16) === hhmm)?.close;
  out(`History 1 June 2026 (1m candles, ${c.length}): 11:00=${at("11:00")} 12:20=${at("12:20")} 16:59=${at("16:59")} 17:01=${at("17:01")}`);
  if (!c.length) throw new Error("no candles");
});

await step("sui", async () => {
  const client = tatumSui();
  const chain = { chainIdentifier: (await chainAndEpoch()).chain };
  const obj = await client.getObject({ objectId: addresses.memwal.registryId, include: { previousTransaction: true } });
  out(`Tatum Sui GraphQL chainIdentifier: ${chain.chainIdentifier}`);
  out(`Tatum Sui GraphQL object(MemWal registry ${addresses.memwal.registryId.slice(0, 10)}…): version ${obj.object.version}, type ${obj.object.type}`);
  const digest = (obj.object as { previousTransaction?: string }).previousTransaction;
  if (digest) {
    const tx = await client.getTransaction({ digest, include: { effects: true } });
    out(`Tatum Sui GraphQL transaction(${digest}): success=${(tx.Transaction ?? tx.FailedTransaction)?.effects?.status.success}`);
  }
  // JSON-RPC, once, for the record.
  const r = await fetch(addresses.sui.tatumJsonRpc, { method: "POST", headers: { "content-type": "application/json", "x-api-key": config.tatumKey }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sui_getChainIdentifier", params: [] }) });
  out(`Tatum Sui JSON-RPC sui_getChainIdentifier: HTTP ${r.status} ${(await r.text()).slice(0, 160)}`);
});

await step("polygon", async () => {
  const g = await gammaMarket(MSTR);
  const from = await blockAt(Date.parse("2026-05-05T00:00:00Z") / 1000);
  const to = await blockAt(Date.parse("2026-06-05T00:00:00Z") / 1000);
  out(`Blocks 5 May → 5 June 2026: ${from} → ${to}`);
  const ups = await bulletinUpdates(g.questionId, from, to);
  out(`BulletinBoard AncillaryDataUpdated for questionID ${g.questionId.slice(0, 12)}…: ${ups.length} update(s)`);
  for (const u of ups) out(`- block ${u.block} tx ${u.tx} owner ${u.owner}: "${u.text.slice(0, 300).replace(/\n/g, " ")}"`);
  const june1 = await blockAt(Date.parse("2026-06-01T00:00:00Z") / 1000), june4 = await blockAt(Date.parse("2026-06-04T00:00:00Z") / 1000);
  const ds = await disputes(june1, june4);
  const mine = ds.filter((d) => d.questionId.toLowerCase() === g.questionId.toLowerCase());
  out(`DisputePrice events 1–4 June 2026: ${ds.length} total, ${mine.length} for the MSTR question`);
  for (const d of mine) out(`- block ${d.block} tx ${d.tx} disputer ${d.disputer}`);
  out(ups.some((u) => u.block >= june1) ? `The 1 June clarification IS on-chain.` : `No bulletin-board update for this question in the window: the 1 June clarification is NOT on-chain as an AncillaryDataUpdated log.`);
});

await step("memwal", async () => {
  for (const name of ["PRECEDENTS", "COURT", "USER"] as const) {
    const ns = "smoke";
    const text = `SMOKE | account:${name} | at:${new Date().toISOString()} | fine print smoke test`;
    const t0 = Date.now();
    const w = await rememberAndWait(name, ns, text);
    const t1 = Date.now();
    let hits = await recall(name, ns, "fine print smoke test", 5);
    for (let i = 0; i < 12 && !hits.some((h) => h.blobId === w.blobId); i++) { await new Promise((r) => setTimeout(r, 5000)); hits = await recall(name, ns, "fine print smoke test", 5); }
    const found = hits.some((h) => h.blobId === w.blobId);
    out(`${name} (${config.account(name).accountId.slice(0, 10)}…): remember → blob ${w.blobId} in ${t1 - t0} ms; recall found it: ${found} after ${Date.now() - t1} ms`);
    if (!found) throw new Error(`${name}: written blob not recallable yet`);
  }
});

await step("x402", async () => {
  const bot = Ed25519Keypair.fromSecretKey(config.botKey);
  out(`Payment network: sui:${payNetwork()}`);
  out(`Bot ${bot.toSuiAddress()} USDC: ${JSON.stringify(await usdcBalances(bot.toSuiAddress()))}`);
  const base = process.env.FINEPRINT_URL ?? config.publicUrl;
  const r = await buyRuling(base, MSTR, bot);
  out(`402 → paid ${r.payment.amount} USDC, digest ${r.payment.digest} (${payExplorerTx(r.payment.digest)})`);
  out(`Ruling: ${r.ruling.verdict} p=${r.ruling.pDispute} cites=${(r.ruling.cites ?? []).map((c: any) => c.blobId).join(",")}`);
  out(`Server-side re-check of the digest through Tatum Sui GraphQL (${payNetwork()}): ${await confirmDigest(r.payment.digest, r.payment.amount)}`);
  out(`Timings: challenge ${r.ms.challenge} ms, pay+ruling ${r.ms.pay} ms`);
});

out(`## Summary`);
for (const [k, v] of Object.entries(results)) out(`- ${k}: ${v}`);
out(["", "Tatum call latencies in this run:", "```", JSON.stringify(summarise(peekSamples()), null, 1), "```"].join("\n"));
if (which === "all") writeFileSync(new URL("../docs/smoke.md", import.meta.url), lines.join("\n") + "\n");
