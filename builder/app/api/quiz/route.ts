import { NextResponse } from "next/server";
import { jsonReply, llm, llmEnv } from "@template/lib/serverLlm";

export const runtime = "nodejs";

interface Paragraph {
  id: string;
  text: string;
}

interface Body {
  chapterId: string;
  chapterTitle: string;
  paragraphs: Paragraph[];
  count?: number;
}

interface AiQuestion {
  question: string;
  options: string[];
  answerIndex: number;
  explanation?: string;
  sourceId?: string;
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

  if (
    !body ||
    typeof body !== "object" ||
    typeof body.chapterId !== "string" ||
    typeof body.chapterTitle !== "string" ||
    !Array.isArray(body.paragraphs) ||
    body.paragraphs.length === 0 ||
    body.paragraphs.length > 100 ||
    body.paragraphs.some((paragraph) =>
      !paragraph ||
      typeof paragraph.id !== "string" ||
      typeof paragraph.text !== "string",
    )
  ) {
    return NextResponse.json({ error: "A chapter and its paragraphs are required." }, { status: 400 });
  }

  const requestedCount = Number.isFinite(body.count) ? body.count ?? 5 : 5;
  const count = Math.min(10, Math.max(1, requestedCount));
  const excerpt = body.paragraphs
    .map((paragraph) => `[${paragraph.id.slice(0, 100)}] ${paragraph.text.slice(0, 700)}`)
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
            `Chapter: "${body.chapterTitle.slice(0, 300)}". Write ${count} multiple-choice questions testing understanding of the excerpt below. ` +
            `Rules: base every question ONLY on the excerpt; include "sourceId" of the paragraph that supports it; ` +
            `exactly 4 options; exactly one correct ("answerIndex" 0-3); add a one-sentence "explanation".\n\n${excerpt}\n\n` +
            `Reply as JSON: {"questions": [{"question": string, "options": [string, string, string, string], "answerIndex": number, "explanation": string, "sourceId": string}]}`,
        },
      ],
      { json: true, temperature: 0.3, maxTokens: 8000 },
    );
    const parsed = jsonReply<{ questions?: AiQuestion[] }>(reply);
    const questions = (parsed.questions ?? []).filter(
      (question) =>
        question.question &&
        Array.isArray(question.options) &&
        question.options.length === 4 &&
        question.answerIndex >= 0 &&
        question.answerIndex < 4,
    );
    return NextResponse.json({ questions, chapter: body.chapterTitle });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
