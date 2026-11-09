/**
 * Sui mainnet through Tatum's gateway.
 *
 * Tatum's Sui JSON-RPC endpoint now answers 404 (JSON-RPC is being retired on
 * mainnet), and its gRPC endpoint speaks native gRPC (application/grpc), which
 * the fetch-based gRPC-web transport cannot read from Node or a Worker. Tatum's
 * Sui GraphQL endpoint works, and @mysten/sui's GraphQL client exposes the same
 * core API (reads, balances, execute), so every Sui call goes through it.
 */
import { SuiGraphQLClient } from "@mysten/sui/graphql";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { addresses, config } from "../config.js";
import { throttledFetch } from "./limit.js";

export type SuiNet = "mainnet" | "testnet";
const clients = new Map<SuiNet, SuiGraphQLClient>();
let publicNode: SuiGrpcClient | null = null;

const urlFor = (net: SuiNet) => (net === "mainnet" ? addresses.sui.tatumGraphql : addresses.sui.tatumGraphqlTestnet);
const keyFor = (net: SuiNet) => (net === "mainnet" ? config.tatumKey : process.env.TATUM_API_KEY_TESTNET || config.tatumKey);

/** Tatum's Sui GraphQL gateway. Memory lives on mainnet; payments run on PAY_NETWORK. */
export function tatumSui(net: SuiNet = "mainnet"): SuiGraphQLClient {
  let c = clients.get(net);
  if (!c) { c = new SuiGraphQLClient({ network: net, url: urlFor(net), headers: { "x-api-key": keyFor(net) }, fetch: throttledFetch }); clients.set(net, c); }
  return c;
}

/** Mysten's public fullnode, used only as a fallback and for cross-checks. */
export function publicSui(): SuiGrpcClient {
  publicNode ??= new SuiGrpcClient({ network: "mainnet", baseUrl: "https://fullnode.mainnet.sui.io" });
  return publicNode;
}

/** Raw query against Tatum's Sui GraphQL, for fields the SDK reads a different way. */
export async function tatumGraphql<T>(query: string, variables: Record<string, unknown> = {}, net: SuiNet = "mainnet"): Promise<T> {
  const r = await throttledFetch(urlFor(net), { method: "POST", headers: { "content-type": "application/json", "x-api-key": keyFor(net) }, body: JSON.stringify({ query, variables }) });
  const body = (await r.json()) as { data?: T; errors?: { message: string }[] };
  if (!body.data) throw new Error(`Tatum Sui GraphQL: ${body.errors?.map((e) => e.message).join("; ") ?? r.status}`);
  return body.data;
}

/** The chain identifier (genesis checkpoint digest) and current epoch. */
export async function chainAndEpoch(net: SuiNet = "mainnet"): Promise<{ chain: string; epoch: string }> {
  const d = await tatumGraphql<{ chainIdentifier: string; epoch: { epochId: number } }>("{ chainIdentifier epoch { epochId } }", {}, net);
  return { chain: d.chainIdentifier, epoch: String(d.epoch.epochId) };
}
