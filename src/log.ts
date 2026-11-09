/** Structured logging: one JSON object per line, which Workers Logs and local terminals both read well. */
type Level = "info" | "warn" | "error";

function write(level: Level, event: string, fields: Record<string, unknown>) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...fields });
  (level === "info" ? console.log : console.error)(line);
}

const errFields = (err: unknown) => {
  const e = err as { message?: string; status?: number };
  return { error: (e?.message ?? String(err)).slice(0, 400), status: e?.status };
};

export const log = {
  info: (event: string, fields: Record<string, unknown> = {}) => write("info", event, fields),
  warn: (event: string, fields: Record<string, unknown> = {}) => write("warn", event, fields),
  error: (event: string, err?: unknown, fields: Record<string, unknown> = {}) =>
    write("error", event, { ...fields, ...(err !== undefined ? errFields(err) : {}) }),
};
