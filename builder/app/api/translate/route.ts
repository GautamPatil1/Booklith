import { NextResponse } from "next/server";
import { llm, llmEnv } from "@template/lib/serverLlm";

export const runtime = "nodejs";

interface Body {
  id: string;
  text: string;
  lang: string;
  langLabel?: string;
}

const memCache = new Map<string, string>();

function key(body: Body): string {
  return `${body.lang}:${body.id}:${body.text.length}`;
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
      { temperature: 0.2, maxTokens: 4096 },
    );
    memCache.set(key(body), translation);
    if (memCache.size > 500) memCache.clear();
    return NextResponse.json({ translation });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
