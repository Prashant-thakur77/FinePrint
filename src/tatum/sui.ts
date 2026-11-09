/**
 * Sui mainnet through Tatum's gRPC gateway (x-api-key header).
 *
 * Sui JSON-RPC is being retired on mainnet, so every read and write here goes
 * over gRPC-web: ledger reads, transaction execution, checkpoint polling.
 */
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { addresses, config } from "../config.js";

let tatum: SuiGrpcClient | null = null;
let publicNode: SuiGrpcClient | null = null;

export function tatumSui(): SuiGrpcClient {
  tatum ??= new SuiGrpcClient({ network: "mainnet", baseUrl: addresses.sui.tatumGrpc, meta: { "x-api-key": config.tatumKey } });
  return tatum;
}

/** Mysten's public fullnode, used only as a fallback and for cross-checks. */
export function publicSui(): SuiGrpcClient {
  publicNode ??= new SuiGrpcClient({ network: "mainnet", baseUrl: "https://fullnode.mainnet.sui.io" });
  return publicNode;
}
