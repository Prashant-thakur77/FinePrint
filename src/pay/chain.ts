/** Sui chain facts the x402 challenge binds to (chain id, epoch), cached briefly. */
import { chainAndEpoch } from "../tatum/sui.js";
import { timed } from "../tatum/latency.js";

let cache: { chain: string; epoch: string; at: number } | null = null;

export async function chainInfo() {
  if (cache && Date.now() - cache.at < 60_000) return cache;
  const c = await timed("tatum.sui", "graphql chainIdentifier+epoch", () => chainAndEpoch());
  cache = { ...c, at: Date.now() };
  return cache;
}
