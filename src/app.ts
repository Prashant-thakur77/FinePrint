/**
 * HTTP routes. Static pages are served by Workers Assets from public/;
 * everything under /api lands here.
 */
import { Hono } from "hono";
import { config } from "./config.js";
import { log } from "./log.js";

export type Env = { DB: D1Database; ASSETS: Fetcher };
export type AppContext = { Bindings: Env };

const app = new Hono<AppContext>();

app.onError((err, c) => {
  log.error("http.error", err, { path: c.req.path });
  return c.json({ error: "internal error" }, 500);
});

app.get("/api/health", (c) => c.json({ ok: true, service: "fineprint", at: new Date().toISOString() }));

/** Cron and admin routes require the shared secret. */
export function authorised(header: string | undefined): boolean {
  const secret = config.cronSecret;
  return Boolean(secret) && header === `Bearer ${secret}`;
}

export default app;
