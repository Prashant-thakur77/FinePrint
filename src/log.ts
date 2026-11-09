/**
 * Logging: every entry is a single JSON line (timestamp, level, event name and
 * fields), which Cloudflare Workers Logs and a local terminal both read well.
 * Warnings and errors go to stderr.
 */
export type LogLevel = "info" | "warn" | "error";

function emit(level: LogLevel, event: string, fields: Record<string, unknown>): void {
  const entry = JSON.stringify({ t: new Date().toISOString(), level, event, ...fields });
  if (level === "info") console.log(entry);
  else console.error(entry);
}

/** The useful part of an error: its message (trimmed) and an HTTP status when it has one. */
function describe(err: unknown): Record<string, unknown> {
  if (err === undefined) return {};
  const e = err as { message?: unknown; status?: unknown };
  const message = typeof e?.message === "string" ? e.message : String(err);
  return { error: message.slice(0, 400), ...(typeof e?.status === "number" ? { status: e.status } : {}) };
}

export const log = {
  info(event: string, fields: Record<string, unknown> = {}) { emit("info", event, fields); },
  warn(event: string, fields: Record<string, unknown> = {}) { emit("warn", event, fields); },
  error(event: string, err?: unknown, fields: Record<string, unknown> = {}) { emit("error", event, { ...fields, ...describe(err) }); },
};
