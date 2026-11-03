import { NextResponse } from "next/server";
import { llm, llmEnv, jsonReply } from "../../../lib/serverLlm";
import { book, blocksById, chapterById } from "../../../lib/book";

export const runtime = "nodejs";

interface Body {
  chapterId: string;
  count?: number;
}

interface AiQuestion {
  question: string;
  options: string[];
  answerIndex: number;
  explanation?: string;
  sourceId?: string;
}

/** AI-generated practice test for a chapter, strictly grounded in its text. */
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
  const ch = chapterById.get(body.chapterId);
  if (!ch) return NextResponse.json({ error: "Unknown chapterId." }, { status: 400 });
  const count = Math.min(10, Math.max(1, body.count ?? 5));

  const texts = ch.blockIds
    .map((id) => blocksById.get(id))
    .filter((b): b is NonNullable<typeof b> => Boolean(b) && b!.type === "paragraph")
    .map((b) => `[${b.id}] ${(b as { text: string }).text.slice(0, 700)}`)
    .join("\n\n")
    .slice(0, 24000);

  try {
    const reply = await llm(
      env,
      [
        { role: "system", content: "You write practice quizzes strictly from the provided text. Reply with STRICT JSON only." },
        {
          role: "user",
          content:
            `Chapter: "${ch.title}". Write ${count} multiple-choice questions testing understanding of the excerpt below. ` +
            `Rules: base every question ONLY on the excerpt; include "sourceId" of the paragraph that supports it; ` +
            `exactly 4 options; exactly one correct ("answerIndex" 0-3); add a one-sentence "explanation".\n\n${texts}\n\n` +
            `Reply as JSON: {"questions": [{"question": string, "options": [string, string, string, string], "answerIndex": number, "explanation": string, "sourceId": string}]}`,
        },
      ],
      { json: true, temperature: 0.3, maxTokens: 8000 }, // headroom for reasoning models
    );
    const parsed = jsonReply<{ questions?: AiQuestion[] }>(reply);
    const questions = (parsed.questions ?? []).filter(
      (q) => q.question && Array.isArray(q.options) && q.options.length === 4 && q.answerIndex >= 0 && q.answerIndex < 4,
    );
    return NextResponse.json({ questions, chapter: ch.title });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
