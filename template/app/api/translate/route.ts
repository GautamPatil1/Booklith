import { NextResponse } from "next/server";
import { llm, llmEnv } from "../../../lib/serverLlm";

export const runtime = "nodejs";

interface Body {
  id: string;
  text: string;
  lang: string;
  langLabel?: string;
}

/** Warm-instance cache; the durable cache is localStorage on the client. */
const memCache = new Map<string, string>();

function key(b: Body): string {
  return `${b.lang}:${b.id}:${b.text.length}`;
}

export async function POST(req: Request) {
  const env = llmEnv();
  if (!env) {
    return NextResponse.json({ error: "API_KEY is not configured on the server." }, { status: 500 });
  }
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body.text?.trim() || !body.lang) {
    return NextResponse.json({ error: "text and lang are required." }, { status: 400 });
  }
  const cached = memCache.get(key(body));
  if (cached) return NextResponse.json({ translation: cached, cached: true });

  try {
    const translation = await llm(
      env,
      [
        {
          role: "system",
          content:
            "You are a faithful literary translator. Translate the user's paragraph into the target language. " +
            "Output ONLY the translation — no preamble, no quotes, no notes. Preserve meaning, tone, and formatting.",
        },
        {
          role: "user",
          content: `Target language: ${body.langLabel ?? body.lang}\n\nParagraph:\n${body.text}`,
        },
      ],
      { temperature: 0.2, maxTokens: 4096 }, // headroom for reasoning models
    );
    memCache.set(key(body), translation);
    if (memCache.size > 500) memCache.clear(); // crude bound
    return NextResponse.json({ translation });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
