import { NextResponse } from "next/server";
import { llm, llmEnv, jsonReply } from "../../../lib/serverLlm";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Body {
  query: string;
}

interface Reference {
  url: string;
  title: string;
  snippet: string;
  verified: boolean;
}

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
}

/**
 * References with a hard anti-hallucination contract:
 *   1. URLs come ONLY from a real web-search API — never from the model's memory.
 *      - Meta Model API (preferred): Responses API + `web_search` tool returns
 *        url_citation annotations tied to live search results.
 *      - Otherwise: Tavily search (bring-your-own key); the LLM writes only
 *        the search queries.
 *   2. Every URL is VERIFIED with a real HTTP request before being shown.
 */
export async function POST(req: Request) {
  const env = llmEnv();
  if (!env) return NextResponse.json({ error: "API_KEY is not configured on the server." }, { status: 500 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const query = (body.query || "").trim();
  if (!query) return NextResponse.json({ error: "query is required." }, { status: 400 });

  try {
    const refs = env.isMeta ? await metaSearchGrounded(env, query) : await tavilySearch(env, query);
    if (refs.length === 0) return NextResponse.json({ references: [], note: "No results from the search API." });
    return NextResponse.json({ references: refs });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}

/** Meta Model API: Responses API with the built-in web_search tool. */
async function metaSearchGrounded(env: NonNullable<ReturnType<typeof llmEnv>>, query: string): Promise<Reference[]> {
  const res = await fetch(`${env.baseUrl}/responses`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.apiKey}` },
    body: JSON.stringify({
      model: env.model,
      input: `Find authoritative web references about: ${query}. Cite your sources.`,
      tools: [{ type: "web_search" }],
      max_output_tokens: 6000,
      reasoning: { effort: "low" },
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Meta search grounding HTTP ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    output?: { type?: string; content?: { type?: string; text?: string; annotations?: { type?: string; url?: string; title?: string }[] }[] }[];
  };
  // collect url_citation annotations — the URLs come from the live search results
  const seen = new Map<string, Reference>();
  for (const item of data.output ?? []) {
    for (const block of item.content ?? []) {
      for (const ann of block.annotations ?? []) {
        if (ann.type === "url_citation" && ann.url && /^https:\/\//.test(ann.url) && !seen.has(ann.url)) {
          seen.set(ann.url, {
            url: ann.url,
            title: ann.title ?? ann.url,
            snippet: (block.text ?? "").slice(0, 220),
            verified: false,
          });
        }
      }
    }
  }
  return verifyAll([...seen.values()].slice(0, 8));
}


/** Non-Meta path: LLM writes search queries; Tavily is the ONLY source of URLs. */
async function tavilySearch(env: NonNullable<ReturnType<typeof llmEnv>>, query: string): Promise<Reference[]> {
  const tavilyKey = process.env.TAVILY_API_KEY;
  if (!tavilyKey) {
    throw new Error("TAVILY_API_KEY is not configured (free at tavily.com) — or set API_BASE_URL to api.meta.ai to use Meta search grounding.");
  }
  const qReply = await llm(
    env,
    [
      { role: "system", content: "You turn topics into web-search queries. Reply with STRICT JSON only. You must NOT output any URLs." },
      { role: "user", content: `Write 3 concise web-search queries (English) to find authoritative references about: ${query}\n\nReply as JSON: {"queries": [string, string, string]}` },
    ],
    { json: true, maxTokens: 2048 },
  );
  const queries = (jsonReply<{ queries?: string[] }>(qReply).queries ?? []).slice(0, 3).filter((q) => q && !/https?:\/\//.test(q));

  const seen = new Set<string>();
  const found: TavilyResult[] = [];
  for (const q of queries) {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: tavilyKey, query: q, max_results: 5, search_depth: "basic" }),
    });
    if (!res.ok) continue;
    const data = (await res.json()) as { results?: TavilyResult[] };
    for (const r of data.results ?? []) {
      if (r.url && /^https:\/\//.test(r.url) && !seen.has(r.url)) {
        seen.add(r.url);
        found.push(r);
      }
    }
  }
  return verifyAll(
    found.slice(0, 8).map((r) => ({
      url: r.url!,
      title: r.title ?? r.url!,
      snippet: (r.content ?? "").slice(0, 220),
      verified: false,
    })),
  );
}

/** Verify each URL with a real request (HEAD, falling back to GET on 405). */
async function verifyAll(refs: Reference[]): Promise<Reference[]> {
  const all = await Promise.all(
    refs.map(async (r): Promise<Reference | null> => {
      try {
        const head = await fetch(r.url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(8000) });
        r.verified = head.ok;
        if (!r.verified && head.status === 405) {
          const get = await fetch(r.url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(8000) });
          r.verified = get.ok;
        }
      } catch {
        r.verified = false;
      }
      return r;
    }),
  );
  const checked = all.filter((r): r is Reference => r !== null);
  const ok = checked.filter((r) => r.verified);
  return ok.length > 0 ? ok : checked;
}
