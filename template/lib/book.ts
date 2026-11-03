import type { Book, Block, Chapter } from "./booklith";
import { getTheme } from "./booklith";
import bookData from "../content/book.json";

/** The book is a static import — the reader is a fixed template, content only swaps. */
export const book = bookData as unknown as Book;

export const theme = getTheme(book.theme.id);

export const blocksById = new Map<string, Block>(book.blocks.map((b) => [b.id, b]));
export const chapterById = new Map<string, Chapter>(book.chapters.map((c) => [c.id, c]));

/** Ordered blocks of a chapter, resolved from ids. */
export function chapterBlocks(ch: Chapter): Block[] {
  return ch.blockIds.map((id) => blocksById.get(id)).filter(Boolean) as Block[];
}

export function blockText(b: Block): string {
  switch (b.type) {
    case "paragraph":
    case "heading":
      return b.text;
    case "table":
      return b.markdown;
    case "figure":
      return b.caption ?? "";
  }
}
