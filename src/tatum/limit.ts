/**
 * Client-side throttle for Tatum's gateway. The free plan allows 3 requests a
 * second per key; we stay just under it across all Tatum services in this
 * process (Prediction Market API, Sui gRPC, Polygon RPC).
 */
const RPS = Number(process.env.TATUM_RPS ?? 2.5);
let next = 0;

export async function tatumSlot(): Promise<void> {
  const now = Date.now();
  const at = Math.max(now, next);
  next = at + 1000 / RPS;
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

/** fetch wrapper that waits for a slot; used by the gRPC transport too. */
export const throttledFetch: typeof fetch = async (input, init) => {
  await tatumSlot();
  return fetch(input, init);
};
