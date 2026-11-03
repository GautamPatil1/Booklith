/**
 * Book integrity validator.
 *
 * The AI harness is allowed to REGROUP blocks into chapters, pick a theme,
 * and edit metadata (title/description) — but NEVER to add, drop, or alter a
 * single character of paragraph / heading / table / caption text. This module
 * compares the final Book against the pipeline's `source` snapshot and fails
 * loudly on any drift. The builder runs it after every AI step and right
 * before export; the exported reader also runs it at startup in dev.
 */

import type { Book, SourceText, ValidationResult } from "../types.js";

/** Whitespace-only normalization: never changes any visible character. */
export function normWs(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function validateBook(book: Book, source: SourceText[]): ValidationResult {
  const errors: string[] = [];

  // 1. Unique ids.
  const ids = new Set<string>();
  for (const b of book.blocks) {
    if (ids.has(b.id)) errors.push(`Duplicate block id: ${b.id}`);
    ids.add(b.id);
  }
  const chapterIds = new Set(book.chapters.map((c) => c.id));
  for (const c of book.chapters) {
    if ([...chapterIds].filter((x) => x === c.id).length > 1) errors.push(`Duplicate chapter id: ${c.id}`);
  }

  // 2. Every source paragraph must survive, verbatim.
  const byId = new Map(book.blocks.map((b) => [b.id, b]));
  for (const src of source) {
    const b = byId.get(src.id);
    if (!b) {
      errors.push(`LOST: ${src.kind} ${src.id} is missing from the book (${preview(src.text)})`);
      continue;
    }
    const actual = blockText(b);
    if (actual === null) {
      errors.push(`CHANGED TYPE: ${src.id} was a ${src.kind} but is now a ${b.type}`);
      continue;
    }
    if (normWs(actual) !== normWs(src.text)) {
      errors.push(
        `ALTERED: ${src.id} text was modified.\n  expected: ${preview(src.text)}\n  actual:   ${preview(actual)}`,
      );
    }
  }

  // 3. No invented blocks: every block must map back to a source entry.
  const srcIds = new Set(source.map((s) => s.id));
  for (const b of book.blocks) {
    if (!srcIds.has(b.id)) {
      errors.push(`INVENTED: block ${b.id} does not exist in the OCR source.`);
    }
  }

  // 4. Chapters cover every block exactly once, in reading order.
  const blockOrder = book.blocks.map((b) => b.id);
  const covered: string[] = [];
  for (const c of book.chapters) {
    if (!c.title?.trim()) errors.push(`Chapter ${c.id} has an empty title.`);
    for (const id of c.blockIds) {
      if (!byId.has(id)) {
        errors.push(`Chapter ${c.id} references unknown block ${id}.`);
        continue;
      }
      covered.push(id);
    }
  }
  if (covered.length !== blockOrder.length) {
    const missing = blockOrder.filter((id) => !covered.includes(id));
    if (missing.length) errors.push(`UNCATEGORIZED: ${missing.length} block(s) are in no chapter: ${missing.slice(0, 5).join(", ")}…`);
    const dupes = covered.filter((id, i) => covered.indexOf(id) !== i);
    if (dupes.length) errors.push(`DUPLICATED: blocks assigned to multiple chapters: ${[...new Set(dupes)].slice(0, 5).join(", ")}…`);
  }
  // order preservation
  const filteredCovered = covered.filter((id) => byId.has(id));
  const srcOrder = blockOrder.join("\u0000");
  const coverOrder = filteredCovered.join("\u0000");
  if (srcOrder !== coverOrder) {
    errors.push("REORDERED: chapter membership changed the reading order of blocks.");
  }

  // 5. Block chapterId consistency.
  for (const c of book.chapters) {
    for (const id of c.blockIds) {
      const b = byId.get(id);
      if (b && b.chapterId && b.chapterId !== c.id) {
        errors.push(`Block ${id} says it belongs to chapter ${b.chapterId} but is listed under ${c.id}.`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

function blockText(b: Book["blocks"][number]): string | null {
  switch (b.type) {
    case "paragraph":
      return b.text;
    case "heading":
      return b.text;
    case "table":
      return b.markdown;
    case "figure":
      return b.caption ?? "";
    default:
      return null;
  }
}

function preview(text: string): string {
  const t = normWs(text);
  return t.length > 80 ? `${t.slice(0, 80)}…` : t;
}
