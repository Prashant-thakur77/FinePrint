/**
 * Records how long every Tatum call takes, per service and method, so the
 * proof page and REPORT.md can show real latencies. In-memory per process;
 * the Worker flushes samples to D1, scripts write them to eval/results.
 */
export interface Sample { service: string; method: string; ms: number; ok: boolean; at: number }

const samples: Sample[] = [];

export async function timed<T>(service: string, method: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    const r = await fn();
    samples.push({ service, method, ms: Date.now() - start, ok: true, at: start });
    return r;
  } catch (err) {
    samples.push({ service, method, ms: Date.now() - start, ok: false, at: start });
    throw err;
  } finally {
    if (samples.length > 5000) samples.splice(0, samples.length - 5000);
  }
}

export const drainSamples = () => samples.splice(0, samples.length);
export const peekSamples = () => [...samples];

export function summarise(list: Sample[]) {
  const by = new Map<string, number[]>();
  for (const s of list) if (s.ok) by.set(`${s.service} ${s.method}`, [...(by.get(`${s.service} ${s.method}`) ?? []), s.ms]);
  const pct = (xs: number[], p: number) => xs.sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))];
  return [...by].map(([k, xs]) => ({ call: k, n: xs.length, p50: pct(xs, 50), p95: pct(xs, 95) }));
}
