import { NextResponse } from "next/server";
import { buildIndex } from "../../../lib/retrieval";
import { llm, llmEnv, type Msg } from "../../../lib/serverLlm";
import { book, blocksById, chapterById } from "../../../lib/book";

export const runtime = "nodejs";

interface Body {
  question: string;
  pinned?: string[];
  pinnedChapters?: string[];
  history?: { role: "user" | "assistant"; content: string }[];
}

/**
 * Chat with RAG over the whole book. Pinned paragraphs/chapters are injected
 * as TOP-PRIORITY context ahead of retrieved paragraphs; the model must cite
 * paragraph ids, which the client renders as clickable chips.
 */
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
  const question = (body.question || "").trim();
  if (!question) return NextResponse.json({ error: "Question is required." }, { status: 400 });

  const index = buildIndex(book);
  const pinnedSet = new Set(body.pinned ?? []);

  // 1. top-priority context: pinned paragraphs, then pinned chapters' paragraphs
  const priority: { id: string; text: string }[] = [];
  for (const id of body.pinned ?? []) {
    const b = blocksById.get(id);
    if (b && (b.type === "paragraph" || b.type === "heading")) priority.push({ id, text: b.text });
  }
  for (const cid of body.pinnedChapters ?? []) {
    const ch = chapterById.get(cid);
    if (!ch) continue;
    for (const id of ch.blockIds) {
      if (pinnedSet.has(id)) continue;
      const b = blocksById.get(id);
      if (b && (b.type === "paragraph" || b.type === "heading") && b.text.length > 80) {
        priority.push({ id, text: b.text.slice(0, 600) });
        if (priority.length > 12) break;
      }
    }
  }

  // 2. lexical retrieval over the whole book for the question
  const retrieved = index.search(question, 8, pinnedSet).filter((r) => r.text.length > 40);
  const context = [...priority, ...retrieved]
    .slice(0, 16)
    .map((r) => `[${r.id}] ${r.text.slice(0, 900)}`)
    .join("\n\n");

  const messages: Msg[] = [
    {
      role: "system",
      content:
        `You are a careful reading assistant for the book "${book.meta.title}". ` +
        `Answer ONLY from the provided excerpts. Cite every claim with the paragraph id in square brackets, e.g. [p-0007]. ` +
        `If the excerpts don't contain the answer, say so plainly. Never invent content.`,
    },
    ...(body.history ?? []).slice(-6).map((m) => ({ role: m.role, content: m.content }) as Msg),
    {
      role: "user",
      content: `Book excerpts:\n\n${context}\n\nQuestion: ${question}`,
    },
  ];

  try {
    const answer = await llm(env, messages, { temperature: 0.2, maxTokens: 4096 }); // headroom for reasoning models
    const citations = [...answer.matchAll(/\[(p-\d{3,4}|h-\d{3}|tbl-\d{3}|fig-\d{3})\]/g)].map((m) => m[1]);
    return NextResponse.json({ answer, citations: [...new Set(citations)] });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
