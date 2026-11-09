/** Cloudflare Worker entry: HTTP via Hono, scheduled jobs via cron triggers. */
import app, { runCron, type Env } from "./app.js";
import { log } from "./log.js";

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runCron(env).then((r) => log.info("cron.done", { cron: event.cron, result: r })).catch((err) => log.error("cron.failed", err)));
  },
} satisfies ExportedHandler<Env>;
