/**
 * Configuration, read lazily from process.env.
 *
 * The same modules run in two places: the Cloudflare Worker (where nodejs_compat
 * fills process.env from the Worker's vars and secrets) and the local Node
 * scripts that seed memory and run the evals (where dotenv fills it from .env).
 * Reading lazily means a script that never touches payments does not need the
 * payment keys.
 */
import addresses from "../config/addresses.json" with { type: "json" };

function env(name: string, fallback = ""): string {
  return (typeof process !== "undefined" ? process.env[name] : undefined) ?? fallback;
}

export function required(name: string): string {
  const v = env(name);
  if (!v) throw new Error(`Missing env var ${name}. Copy .env.example to .env and fill it in.`);
  return v;
}

export const config = {
  get tatumKey() { return required("TATUM_API_KEY"); },
  get anthropicKey() { return required("ANTHROPIC_API_KEY"); },
  get model() { return env("LLM_MODEL", "claude-sonnet-4-5"); },
  get memwalServerUrl() { return env("MEMWAL_SERVER_URL", "https://relayer.memory.walrus.xyz"); },
  get memwalPackageId() { return env("MEMWAL_PACKAGE_ID", addresses.memwal.packageId); },
  get memwalRegistryId() { return env("MEMWAL_REGISTRY_ID", addresses.memwal.registryId); },
  get serverKey() { return required("SUI_SERVER_PRIVATE_KEY"); },
  get botKey() { return required("SUI_BOT_PRIVATE_KEY"); },
  get serverAddress() { return env("SUI_SERVER_ADDRESS"); },
  get cronSecret() { return env("CRON_SECRET"); },
  get rulingPriceUsdc() { return Number(env("RULING_PRICE_USDC", "0.02")); },
  get publicUrl() { return env("PUBLIC_URL", "https://fineprint.prashantthakur.dev"); },
  account(name: "PRECEDENTS" | "COURT" | "USER") {
    return { accountId: env(`MEMWAL_ACCOUNT_ID_${name}`), key: env(`MEMWAL_KEY_${name}`) };
  },
};

export { addresses };
