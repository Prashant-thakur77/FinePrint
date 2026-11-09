/** Conditions (b) + precedents and (c) + patterns.  npx tsx eval/run_fineprint.ts <precedents|patterns> [repeats=3] [limit=300] */
import { runDispute } from "./dispute.js";
const [level = "patterns", repeats = "3", limit = "300"] = process.argv.slice(2);
if (level !== "precedents" && level !== "patterns") throw new Error("level must be precedents or patterns");
await runDispute(level, Number(repeats), Number(limit));
