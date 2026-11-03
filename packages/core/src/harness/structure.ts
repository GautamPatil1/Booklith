/**
 * AI structure harness.
 *
 * The LLM sees ONLY a compact outline (id + short snippet per block) and may:
 *   - group blocks into chapters (contiguous ranges)
 *   - title chapters (new titles are fine — titles are metadata, not book text)
 *   - suggest a book title / description / better language tag
 *   - pick a theme preset id
 * It NEVER sees or produces full paragraph text, and its output is applied
 * purely as metadata; the validator then proves nothing was altered or lost.
 */

import type { Book, Chapter, SourceText, ValidationResult } from "../types.js";
import { llmChat, parseJsonReply, type LlmConfig } from "./llm.js";
import { getTheme, THEME_CATALOG } from "./themes.js";
import { validateBook } from "../pipeline/validator.js";

export interface HarnessResult {
  book: Book;
  validation: ValidationResult;
  notes: string[];
}

const SNIPPET = 110; // chars per block in the outline
const OUTLINE_BUDGET_LINES = 400; // keep prompts small for big books

export function buildOutline(book: Book): string {
  const lines: string[] = [];
  let total = 0;
  // Big books: sample paragraphs, but ALWAYS keep every heading (they carry
  // the structure) and preserve reading order.
  const headings = book.blocks.filter((b) => b.type === "heading").length;
  const others = book.blocks.length - headings;
  const stride = Math.max(1, Math.ceil(others / Math.max(1, OUTLINE_BUDGET_LINES - headings)));
  let seen = 0;
  for (const b of book.blocks) {
    const isHeading = b.type === "heading";
    if (!isHeading && stride > 1) {
      if (seen % stride !== 0) {
        seen++;
        continue;
      }
      seen++;
    }
    const text = b.type === "table" ? b.markdown : b.type === "figure" ? b.caption ?? "" : b.text;
    const snippet = text.length > SNIPPET ? `${text.slice(0, SNIPPET)}…` : text;
    const tag = isHeading ? ` [heading lvl${(b as { level?: number }).level}${(b as { tentative?: boolean }).tentative ? "?" : ""}]` : "";
    const line = `${b.id}${tag}: ${snippet}`;
    if (total + line.length > 90_000 && lines.length > 50) break; // hard char cap
    lines.push(line);
    total += line.length + 1;
  }
  const note =
    stride > 1
      ? `\n(NOTE: the outline shows every heading but only every ${stride}-th non-heading block; ranges may start/end at any id.)\n`
      : "";
  return note + lines.join("\n");
}

interface AiChapters {
  title?: string;
  description?: string;
  language?: string;
  chapters: { title: string; startId: string; endId?: string }[];
}

/**
 * Ask the LLM to (re)structure the book into chapters. Falls back to the
 * existing chapters if the reply fails validation, so the user always keeps
 * a valid book.
 */
export async function improveStructure(
  book: Book,
  source: SourceText[],
  llm: LlmConfig,
  signal?: AbortSignal,
): Promise<HarnessResult> {
  const outline = buildOutline(book);
  const system =
    "You are a book structure editor. You organize OCR'd books into chapters. " +
    "You never write or rewrite the book's text; you only choose chapter boundaries and titles. " +
    "Reply with STRICT JSON only.";
  const user =
    `Here is the outline of a book (block id: snippet). Blocks are in reading order.\n\n` +
    `Book title guess: ${book.meta.title}\nLanguage: ${book.meta.language}\n\n` +
    `${outline}\n\n` +
    `Decide the chapter structure. Rules:\n` +
    `- Chapters must be CONTIGUOUS ranges: give "startId" (first block id in the chapter) and "endId" (last block id, optional = same as startId).\n` +
    `- Every block must be covered by exactly one chapter. Do not skip blocks.\n` +
    `- Prefer real headings as boundaries, but you may start mid-stream if the text clearly shifts topic.\n` +
    `- Titles: reuse the heading text when a heading is there; otherwise write a SHORT descriptive title yourself.\n` +
    `- Also suggest a better book "title" (from the text, not invented), a 1-2 sentence "description", and the correct "language" (ISO 639 code like "en", "mr", "zh").\n\n` +
    `Reply as JSON: {"title": string, "description": string, "language": string, "chapters": [{"title": string, "startId": string, "endId": string}]}`;

  const reply = await llmChat(llm, [{ role: "system", content: system }, { role: "user", content: user }], {
    json: true,
    temperature: 0.1,
    maxTokens: 20000, // headroom for reasoning models (e.g. Meta muse-*)
    signal,
  });

  const parsed = parseJsonReply<AiChapters>(reply);
  const applied = applyChapters(book, parsed);
  const validation = validateBook(applied, source);
  const notes: string[] = [];
  if (parsed.title) notes.push(`Suggested title: ${parsed.title}`);
  if (parsed.description) notes.push(`Description: ${parsed.description}`);
  if (!validation.ok) {
    notes.push("AI structure failed validation — keeping the previous structure.");
    return { book, validation: validateBook(book, source), notes: [...notes, ...validation.errors.slice(0, 5)] };
  }
  return { book: applied, validation, notes };
}

/** Apply model-provided chapter ranges + metadata to the book. Text is untouched. */
export function applyChapters(book: Book, ai: AiChapters): Book {
  const order = book.blocks.map((b) => b.id);
  const indexOf = new Map(order.map((id, i) => [id, i]));
  const chapters: Chapter[] = [];
  let n = 0;
  for (const ch of ai.chapters ?? []) {
    const start = indexOf.get(ch.startId);
    if (start === undefined) continue;
    const end = ch.endId ? (indexOf.get(ch.endId) ?? start) : start;
    const [lo, hi] = start <= end ? [start, end] : [end, start];
    const blockIds = order.slice(lo, hi + 1);
    if (blockIds.length === 0) continue;
    chapters.push({ id: `c-${String(++n).padStart(2, "0")}`, title: ch.title?.trim() || `Chapter ${n}`, blockIds });
  }
  // Safety: if coverage is broken, keep old chapters.
  const coveredCount = chapters.reduce((s, c) => s + c.blockIds.length, 0);
  if (chapters.length === 0 || coveredCount !== order.length) {
    chapters.length = 0;
    chapters.push(...book.chapters);
  }
  const blockChapter = new Map<string, string>();
  for (const c of chapters) for (const id of c.blockIds) blockChapter.set(id, c.id);
  const blocks = book.blocks.map((b) => ({ ...b, chapterId: blockChapter.get(b.id) ?? b.chapterId }));
  return {
    ...book,
    meta: {
      ...book.meta,
      title: ai.title?.trim() || book.meta.title,
      description: ai.description?.trim() || book.meta.description,
      language: ai.language?.trim() || book.meta.language,
    },
    blocks,
    chapters,
  };
}

/** Let the model pick a theme id from the fixed catalog (or keep current). */
export async function pickTheme(book: Book, llm: LlmConfig, signal?: AbortSignal): Promise<{ themeId: string; reason: string }> {
  const sample = book.blocks
    .filter((b) => b.type === "paragraph")
    .slice(0, 10)
    .map((b) => (b.type === "paragraph" ? b.text.slice(0, 100) : ""))
    .join(" / ");
  const catalog = THEME_CATALOG.map((t) => `${t.id} — ${t.name}: ${t.vibe}`).join("\n");
  const reply = await llmChat(
    llm,
    [
      { role: "system", content: "You pick reading themes. Reply with STRICT JSON only." },
      {
        role: "user",
        content:
          `Book: "${book.meta.title}" (${book.meta.language}). Chapters: ${book.chapters.map((c) => c.title).join(", ")}.\n` +
          `Sample text: ${sample}\n\nTheme catalog:\n${catalog}\n\n` +
          `Pick the most fitting theme id. Reply as JSON: {"themeId": string, "reason": string}`,
      },
    ],
    { json: true, temperature: 0.2, signal },
  );
  const parsed = parseJsonReply<{ themeId?: string; reason?: string }>(reply);
  const id = parsed.themeId && THEME_CATALOG.some((t) => t.id === parsed.themeId) ? parsed.themeId : book.theme.id;
  return { themeId: id, reason: parsed.reason ?? `Theme set to ${getTheme(id).name}` };
}


