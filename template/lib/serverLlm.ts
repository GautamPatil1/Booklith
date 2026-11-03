/** Shared server-side LLM helper for the reader's serverless API routes. */

export interface LlmEnv {
  apiKey: string;
  baseUrl: string;
  model: string;
  /** true when the configured API is Meta's Model API (api.meta.ai). */
  isMeta: boolean;
}

export function llmEnv(): LlmEnv | null {
  const apiKey = process.env.API_KEY;
  if (!apiKey) return null;
  const baseUrl = (process.env.API_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  const isMeta = /api\.meta\.ai/.test(baseUrl);
  return {
    apiKey,
    baseUrl,
    model: process.env.API_MODEL || (isMeta ? "muse-spark-1.3" : "gpt-4o-mini"),
    isMeta,
  };
}

export interface Msg {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Reasoning-effort control for Meta muse-* models. Meta models burn output
 * tokens on private reasoning; per Meta's docs, direct-answer tasks (lookups,
 * translation, formatting) should use "low". Only sent for Meta endpoints so
 * OpenAI-style APIs stay untouched.
 */
function effortFor(env: LlmEnv, requested?: string): string | undefined {
  if (!env.isMeta) return undefined;
  return requested ?? "low";
}

export async function llm(
  env: LlmEnv,
  messages: Msg[],
  opts: { json?: boolean; maxTokens?: number; temperature?: number; reasoningEffort?: string } = {},
): Promise<string> {
  const res = await fetch(`${env.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.apiKey}` },
    body: JSON.stringify({
      model: env.model,
      messages,
      temperature: opts.temperature ?? 0.2,
      max_tokens: opts.maxTokens ?? 4096,
      ...(opts.json ? { response_format: { type: "json_object" } } : {}),
      ...(effortFor(env, opts.reasoningEffort) ? { reasoning_effort: effortFor(env, opts.reasoningEffort) } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`LLM API HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM returned an empty response.");
  return content;
}

export function jsonReply<T>(reply: string): T {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(reply);
  const candidate = fenced ? fenced[1] : reply;
  const start = candidate.search(/[[{]/);
  const end = Math.max(candidate.lastIndexOf("}"), candidate.lastIndexOf("]"));
  if (start === -1 || end === -1) throw new Error("Model reply contained no JSON.");
  return JSON.parse(candidate.slice(start, end + 1)) as T;
}
