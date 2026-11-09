/**
 * Polygon mainnet through Tatum's RPC gateway: reads Polymarket's UMA
 * adapter logs.
 *
 *  - AncillaryDataUpdated(bytes32 indexed questionID, address indexed owner, bytes update)
 *    is the adapter's bulletin board: rule clarifications posted after a market
 *    opens. Only updates from the question's creator count, so callers check `owner`.
 *  - DisputePrice(...) on UMA's Optimistic Oracle marks a disputed proposal. The
 *    adapter's questionID is keccak256 of the ancillary data it sent to the
 *    oracle, so a dispute maps back to a market without any off-chain index.
 */
import { keccak_256 } from "@noble/hashes/sha3.js";
import { addresses, config } from "../config.js";
import { timed } from "./latency.js";
import { tatumSlot } from "./limit.js";

const TOPIC = {
  ancillaryDataUpdated: "0x0059e11815211969c0c4aaf3f498b52b6c2f2d14f286275d0862d70de22a836b",
  disputePrice: "0x5165909c3d1c01c5d1e121ac6f6d01dda1ba24bc9e1f975b5a375339c15be7f3",
};

let id = 0;
export async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  return timed("tatum.polygon", method, async () => {
    for (let attempt = 0; ; attempt++) {
      await tatumSlot();
      const r = await fetch(addresses.polygon.tatumRpc, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": config.tatumKey },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
        signal: AbortSignal.timeout(30_000),
      });
      if ((r.status === 429 || r.status >= 500) && attempt < 4) { await new Promise((s) => setTimeout(s, 1000 * 2 ** attempt)); continue; }
      const body = (await r.json()) as { result?: T; error?: { code: number; message: string } };
      if (body.error) throw Object.assign(new Error(`${method}: ${body.error.message}`), { code: body.error.code });
      return body.result as T;
    }
  });
}

export interface Log { address: string; topics: string[]; data: string; blockNumber: string; transactionHash: string; logIndex: string }

export const hex = (n: number) => `0x${n.toString(16)}`;

/** eth_getLogs over a block range, splitting the range whenever the gateway refuses it. */
export async function getLogs(filter: { address: string | string[]; topics: (string | string[] | null)[] }, from: number, to: number, step = 50_000): Promise<Log[]> {
  const out: Log[] = [];
  for (let start = from; start <= to; ) {
    const end = Math.min(to, start + step - 1);
    try {
      out.push(...(await rpc<Log[]>("eth_getLogs", [{ ...filter, fromBlock: hex(start), toBlock: hex(end) }])));
      start = end + 1;
    } catch (err) {
      if (step <= 500) throw err;
      step = Math.floor(step / 4);
    }
  }
  return out;
}

export async function blockNumber(): Promise<number> {
  return parseInt(await rpc<string>("eth_blockNumber", []), 16);
}

export async function blockTime(n: number): Promise<number> {
  const b = await rpc<{ timestamp: string }>("eth_getBlockByNumber", [hex(n), false]);
  return parseInt(b.timestamp, 16);
}

/** First block at or after a unix time (binary search, ~25 calls). */
export async function blockAt(unix: number): Promise<number> {
  let lo = 1, hi = await blockNumber();
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if ((await blockTime(mid)) < unix) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/** Decodes one ABI `bytes` value starting at a word offset inside `data`. */
function abiBytes(data: string, offsetWord: number): string {
  const d = data.slice(2);
  const off = parseInt(d.slice(offsetWord * 64, offsetWord * 64 + 64), 16) * 2;
  const len = parseInt(d.slice(off, off + 64), 16) * 2;
  return d.slice(off + 64, off + 64 + len);
}

const utf8 = (h: string) => Buffer.from(h, "hex").toString("utf8");
const addr = (topic: string) => `0x${topic.slice(-40)}`;

export interface BulletinUpdate { questionId: string; owner: string; text: string; block: number; tx: string; at?: number }

export async function bulletinUpdates(questionId: string, fromBlock: number, toBlock: number, adapters = [addresses.polygon.umaCtfAdapterV3, addresses.polygon.umaCtfAdapterV2, addresses.polygon.umaCtfAdapterV2b, addresses.polygon.umaCtfAdapterV1, addresses.polygon.umaCtfAdapterV3b, addresses.polygon.negRiskUmaCtfAdapter]): Promise<BulletinUpdate[]> {
  const logs = await getLogs({ address: adapters, topics: [TOPIC.ancillaryDataUpdated, questionId.toLowerCase()] }, fromBlock, toBlock);
  return logs.map((l) => ({ questionId: l.topics[1], owner: addr(l.topics[2]), text: utf8(abiBytes(l.data, 0)), block: parseInt(l.blockNumber, 16), tx: l.transactionHash }));
}

export interface Dispute { questionId: string; requester: string; proposer: string; disputer: string; block: number; tx: string; title: string }

/** All disputes raised against Polymarket adapters' price requests in a block range. */
export async function disputes(fromBlock: number, toBlock: number, step = 50_000): Promise<Dispute[]> {
  const p = addresses.polygon;
  const requesters = [p.umaCtfAdapterV3, p.umaCtfAdapterV2, p.umaCtfAdapterV2b, p.umaCtfAdapterV1, p.umaCtfAdapterV3b, p.negRiskUmaCtfAdapter].map((a) => `0x000000000000000000000000${a.slice(2).toLowerCase()}`);
  const logs = await getLogs({ address: [p.optimisticOracleV2, p.managedOptimisticOracleV2], topics: [TOPIC.disputePrice, requesters] }, fromBlock, toBlock, step);
  return logs.map((l) => {
    // data: identifier (bytes32), timestamp (uint256), ancillaryData (bytes, offset), proposedPrice (int256)
    const ancillary = abiBytes(l.data, 2);
    const questionId = `0x${Buffer.from(keccak_256(Buffer.from(ancillary, "hex"))).toString("hex")}`;
    const text = utf8(ancillary);
    const title = /title:\s*(.*?)(,\s*description:|$)/s.exec(text)?.[1]?.slice(0, 200) ?? "";
    return { questionId, requester: addr(l.topics[1]), proposer: addr(l.topics[2]), disputer: addr(l.topics[3]), block: parseInt(l.blockNumber, 16), tx: l.transactionHash, title };
  });
}
