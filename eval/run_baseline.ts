/** Condition (a): rule text only.  npx tsx eval/run_baseline.ts rules [repeats=3] [limit=300] */
import { runDispute } from "./dispute.js";
const [, repeats = "3", limit = "300"] = process.argv.slice(2);
await runDispute("rules", Number(repeats), Number(limit));
