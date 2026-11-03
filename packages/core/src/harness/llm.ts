/**
 * Minimal OpenAI-compatible chat client (browser-side, bring-your-own-key).
 *
 * Works with OpenAI, Groq, Together, OpenRouter, DeepSeek, local vLLM/Ollama
 * with OpenAI schemas — anything speaking /v1/chat/completions. The key is
 * provided by the user in the builder UI and lives in their browser only;
 * Booklith servers never see it.
 */

export interface LlmConfig {
  baseUrl: string; // e.g. https://api.openai.com/v1
  apiKey: string;
  model: string; // e.g. gpt-4o-mini
  /**
   * Optional reasoning-effort hint for reasoning models (Meta muse-*:
   * "minimal" | "low" | "medium" | "high" | "xhigh" | "max"). Only sent when
   * set, so non-reasoning APIs (plain OpenAI chat models) are unaffected.
   */
  reasoningEffort?: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export class LlmError extends Error {
  constructor(message: string, public readonly hint?: string) {
    super(message);
    this.name = "LlmError";
  }
}

export async function llmChat(
  cfg: LlmConfig,
  messages: ChatMessage[],
  opts: { json?: boolean; temperature?: number; maxTokens?: number; signal?: AbortSignal; reasoningEffort?: string } = {},
): Promise<string> {
  if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) {
    throw new LlmError("LLM is not configured: set base URL, API key, and model.");
  }
  const base = cfg.baseUrl.replace(/\/+$/, "");
  const url = base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
  const effort = opts.reasoningEffort ?? cfg.reasoningEffort;
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        temperature: opts.temperature ?? 0.2,
        max_tokens: opts.maxTokens ?? 4096,
        ...(opts.json ? { response_format: { type: "json_object" } } : {}),
        ...(effort ? { reasoning_effort: effort } : {}),
      }),
      signal: opts.signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new LlmError(`Could not reach the LLM API: ${(err as Error).message}`);
  }
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new LlmError(
      `LLM API error HTTP ${resp.status}: ${body.slice(0, 400)}`,
      resp.status === 401
        ? "Check your API key."
        : resp.status === 404
          ? "Check the base URL and model name."
          : undefined,
    );
  }
  const data = (await resp.json()) as {
    choices?: { message?: { content?: string }; finish_reason?: string }[];
    usage?: { completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } };
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    const usage = data.usage;
    const finish = data.choices?.[0]?.finish_reason;
    throw new LlmError(
      `LLM returned an empty response (finish_reason=${finish ?? "?"}, completion_tokens=${usage?.completion_tokens ?? "?"}, reasoning_tokens=${usage?.completion_tokens_details?.reasoning_tokens ?? "?"}). ` +
        `Reasoning models need a larger max_tokens budget.`,
    );
  }
  return content;
}

/** Extract the first JSON object/array from a (possibly fenced) model reply. */
export function parseJsonReply<T>(reply: string): T {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(reply);
  const candidate = fenced ? fenced[1] : reply;
  const start = candidate.search(/[[{]/);
  if (start === -1) throw new LlmError("Model reply contained no JSON.");
  // find matching end by scanning to the last } or ]
  const end = Math.max(candidate.lastIndexOf("}"), candidate.lastIndexOf("]"));
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as T;
  } catch (err) {
    throw new LlmError(`Model reply was not valid JSON: ${(err as Error).message}`);
  }
}
