/**
 * The judge model. One model (LLM_MODEL) serves the rule-text-only baseline and
 * Fine Print's judge, so the comparison changes only what the model is shown.
 */
import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.js";

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic({ apiKey: config.anthropicKey, maxRetries: 4 }));

export interface Usage { inputTokens: number; outputTokens: number }

/** Asks for a JSON object and parses it. Retries once if the reply is not valid JSON. */
export async function askJson<T>(system: string, user: string, opts: { maxTokens?: number } = {}): Promise<{ data: T; usage: Usage; raw: string }> {
  let lastRaw = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await anthropic().messages.create({
      model: config.model,
      max_tokens: opts.maxTokens ?? 1200,
      system,
      messages: [
        { role: "user", content: attempt === 0 ? user : `${user}\n\nYour previous reply was not valid JSON. Reply with the JSON object only.` },
      ],
    });
    const raw = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    lastRaw = raw;
    const json = extractJson(raw);
    if (json !== undefined) return { data: json as T, usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens }, raw };
  }
  throw new Error(`model did not return JSON: ${lastRaw.slice(0, 200)}`);
}

function extractJson(s: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(s);
  const body = fenced ? fenced[1] : s;
  const start = body.indexOf("{"), end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try { return JSON.parse(body.slice(start, end + 1)); } catch { return undefined; }
}
