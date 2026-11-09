/** Reads and updates .env in place without ever printing values. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const PATH = new URL("../../.env", import.meta.url);

export function setEnv(updates: Record<string, string>) {
  const lines = existsSync(PATH) ? readFileSync(PATH, "utf8").split("\n") : [];
  for (const [k, v] of Object.entries(updates)) {
    const i = lines.findIndex((l) => l.startsWith(`${k}=`));
    if (i >= 0) lines[i] = `${k}=${v}`;
    else lines.splice(lines.length && lines[lines.length - 1] === "" ? lines.length - 1 : lines.length, 0, `${k}=${v}`);
    process.env[k] = v;
  }
  writeFileSync(PATH, lines.join("\n").replace(/\n*$/, "\n"), { mode: 0o600 });
}
