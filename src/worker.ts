/** Cloudflare Worker entry: HTTP via Hono, scheduled jobs via cron triggers. */
import app, { type Env } from "./app.js";
import { log } from "./log.js";

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    log.info("cron.tick", { cron: event.cron });
  },
} satisfies ExportedHandler<Env>;
