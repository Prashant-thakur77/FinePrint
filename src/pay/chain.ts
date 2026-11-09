/** Sui chain facts the x402 challenge binds to (chain id, epoch), cached briefly. */
import { tatumSui } from "../tatum/sui.js";
import { timed } from "../tatum/latency.js";

let cache: { chain: string; epoch: string; at: number } | null = null;

export async function chainInfo() {
  if (cache && Date.now() - cache.at < 60_000) return cache;
  const client = tatumSui();
  const [chain, state] = await Promise.all([
    timed("tatum.sui", "GetChainIdentifier", () => client.getChainIdentifier()),
    timed("tatum.sui", "GetEpoch", () => client.getCurrentSystemState()),
  ]);
  cache = { chain: chain.chainIdentifier, epoch: String(state.systemState.epoch), at: Date.now() };
  return cache;
}
