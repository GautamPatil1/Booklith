/**
 * Markdown (OCR output) -> Book JSON with stable IDs.
 *
 * Input contract: pages separated by `<!-- page break -->` (what the Modal
 * OCR-2 `parse_pdf` endpoint returns). Output: a Book whose paragraph /
 * heading / figure / table text is VERBATIM from the markdown (modulo page
 * noise stripping and paragraph re-flow joins), plus a `source` array that
 * the validator later checks the AI harness against.
 */

import { blockId } from "../ids.js";
import type {
  Block,
  Book,
  BuildResult,
  Chapter,
  FigureBlock,
  HeadingBlock,
  ParagraphBlock,
  SourceText,
  TableBlock,
} from "../types.js";
import { BOOK_SCHEMA_VERSION } from "../types.js";
import { findRunningHeaders, isPageNumber, isRunningHeader, looksLikeHeading, shouldJoin } from "./heuristics.js";

export interface PipelineOptions {
  title?: string;
  language?: string;
  authors?: string[];
  sourceProvider?: string;
  /** Join hard-wrapped lines into one paragraph (default: true, conservative). */
  joinWrappedLines?: boolean;
}

const PAGE_BREAK_RE = /<!--\s*page break\s*-->/;
const IMG_RE = /!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/;
const TABLE_SEP = /^\s*\|?[\s:|-]+\|[\s:|-]*$/;

export function splitPages(markdown: string): string[] {
  return markdown
    .split(PAGE_BREAK_RE)
    .map((p) => p.replace(/\r\n/g, "\n"))
    .filter((p) => p.trim().length > 0);
}

function isTableLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith("|") && t.includes("|", 1);
}

const MARKER_RE = /^\([\d\u0966-\u096f]{1,3}\)$/;

/** Split a page's raw text into "clean lines": non-empty lines minus noise. */
function cleanLines(page: string, noise: Set<string>, pageNo: number): string[] {
  const out: string[] = [];
  for (const raw of page.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    // keep "(N)" section markers — the block loop consumes them as heading hints
    if (MARKER_RE.test(line)) {
      out.push(line);
      continue;
    }
    if (isPageNumber(line)) continue;
    // Running headers are stripped on every page EXCEPT page 1, where the
    // "header" is usually the genuine book title / first heading.
    if (pageNo > 1 && isRunningHeader(line, noise)) continue;
    // pure ornamentation lines: "***", "---", "· · ·"
    if (/^[-=_*·•.\s]{3,}$/.test(line)) continue;
    out.push(line);
  }
  return out;
}

export function markdownToBook(markdown: string, opts: PipelineOptions = {}): BuildResult {
  const warnings: string[] = [];
  const pageStrings = splitPages(markdown);
  if (pageStrings.length === 0) {
    return { book: emptyBook(opts), source: [], warnings: ["No content found in the OCR output."] };
  }

  // First pass: all page lines, to detect running headers.
  const pages = pageStrings.map((p) => p.split("\n").map((l) => l.trim()).filter((l) => l.length > 0));
  const noise = findRunningHeaders(pages);
  if (noise.size > 0) {
    warnings.push(`Detected and removed ${noise.size} running header/footer line(s) repeated across pages.`);
  }

  const blocks: Block[] = [];
  const source: SourceText[] = [];
  const counters = { paragraph: 0, heading: 0, figure: 0, table: 0 };

  const pushBlock = (b: Block, srcText: string) => {
    blocks.push(b);
    source.push({
      id: b.id,
      kind: b.type === "heading" ? "heading" : b.type === "table" ? "table" : b.type === "figure" ? "figure" : "paragraph",
      text: srcText,
      page: b.page,
    });
  };

  pageStrings.forEach((page, idx) => {
    const pageNo = idx + 1;
    const lines = cleanLines(page, noise, pageNo);
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];

      // "(N)" section marker: skip it; if the next line is a heading candidate,
      // it becomes a non-tentative level-1 heading (chapter title).
      if (MARKER_RE.test(line)) {
        const next = lines[i + 1];
        const marked = next ? looksLikeHeading(next, lines[i + 2], line) : false;
        if (marked && next) {
          const text = next.replace(/^#{1,3}\s+/, "").trim();
          const id = blockId("heading", ++counters.heading);
          pushBlock({ id, type: "heading", level: marked.level, text, tentative: false, page: pageNo } as HeadingBlock, text);
          i += 2;
          continue;
        }
        i++;
        continue;
      }

      // Markdown table: consecutive table lines.
      if (isTableLine(line)) {
        const tbl: string[] = [];
        let j = i;
        while (j < lines.length && isTableLine(lines[j])) {
          tbl.push(lines[j]);
          j++;
        }
        const md = tbl.join("\n");
        const id = blockId("table", ++counters.table);
        pushBlock({ id, type: "table", markdown: md, page: pageNo } as TableBlock, md);
        i = j;
        continue;
      }

      // Markdown image -> figure placeholder (OCR-2 strips raster images, but
      // pasted markdown or other providers may include them).
      const img = IMG_RE.exec(line);
      if (img && line.replace(IMG_RE, "").trim().length === 0) {
        const id = blockId("figure", ++counters.figure);
        pushBlock(
          { id, type: "figure", caption: img[1] || undefined, placeholder: "Figure", page: pageNo } as FigureBlock,
          img[1] || "",
        );
        i++;
        continue;
      }

      // Heading
      const h = looksLikeHeading(line, lines[i + 1], lines[i - 1]);
      if (h) {
        const text = line.replace(/^#{1,3}\s+/, "").trim();
        const id = blockId("heading", ++counters.heading);
        const isMdHeading = /^#{1,3}\s+/.test(line.trim());
        pushBlock(
          {
            id,
            type: "heading",
            level: h.level,
            text,
            tentative: !isMdHeading,
            page: pageNo,
          } as HeadingBlock,
          text,
        );
        i++;
        continue;
      }

      // Paragraph: take this line, then greedily join wrapped continuations.
      const parts: string[] = [line];
      let j = i + 1;
      if (opts.joinWrappedLines !== false) {
        while (j < lines.length) {
          const nxt = lines[j];
          if (isTableLine(nxt) || MARKER_RE.test(nxt) || looksLikeHeading(nxt, lines[j + 1], lines[j - 1]) || IMG_RE.test(nxt)) break;
          if (!shouldJoin(parts[parts.length - 1], nxt)) break;
          parts.push(nxt);
          j++;
        }
      }
      const text = joinParts(parts);
      const id = blockId("paragraph", ++counters.paragraph);
      pushBlock({ id, type: "paragraph", text, page: pageNo } as ParagraphBlock, text);
      i = j;
    }
  });

  const chapters = assignChapters(blocks);
  if (chapters.length === 1 && blocks.length > 0) {
    warnings.push(
      "No chapter headings detected — everything is in a single chapter. Use the AI structure step to split it.",
    );
  }

  const book: Book = {
    schemaVersion: BOOK_SCHEMA_VERSION,
    meta: {
      title: opts.title?.trim() || guessTitle(blocks),
      authors: opts.authors ?? [],
      language: opts.language ?? guessLanguage(markdown),
      description: undefined,
      sourceProvider: opts.sourceProvider ?? "unknown",
      createdAt: new Date().toISOString(),
    },
    theme: { id: "paper", name: "Paper" },
    blocks,
    chapters,
  };
  return { book, source, warnings };
}

function joinParts(parts: string[]): string {
  let out = "";
  for (const part of parts) {
    if (!out) out = part;
    else if (/[-\u2010\u2011]$/.test(out)) out = out.slice(0, -1) + part;
    else out += " " + part;
  }
  return out;
}

/** Initial chapter assignment: level-1 headings (or tentative headings if none) split chapters. */
export function assignChapters(blocks: Block[]): Chapter[] {
  const hasRealH1 = blocks.some((b) => b.type === "heading" && b.level === 1 && !b.tentative);
  const splitter = (b: Block) => b.type === "heading" && (hasRealH1 ? b.level === 1 && !b.tentative : b.level <= 2);
  const chapters: Chapter[] = [];
  let current: Chapter | null = null;
  let n = 0;
  for (const b of blocks) {
    if (splitter(b) && b.type === "heading") {
      current = { id: blockId("chapter", ++n), title: b.text, blockIds: [] };
      chapters.push(current);
    }
    if (!current) {
      current = { id: blockId("chapter", ++n), title: "Front matter", blockIds: [] };
      chapters.push(current);
    }
    current.blockIds.push(b.id);
    b.chapterId = current.id;
  }
  if (chapters.length === 0) chapters.push({ id: blockId("chapter", 1), title: "Content", blockIds: [] });
  return chapters;
}

export function guessTitle(blocks: Block[]): string {
  const h1 = blocks.find((b) => b.type === "heading" && b.level === 1);
  if (h1 && h1.type === "heading") return h1.text;
  const anyHeading = blocks.find((b) => b.type === "heading");
  if (anyHeading && anyHeading.type === "heading") return anyHeading.text;
  const firstPara = blocks.find((b) => b.type === "paragraph");
  if (firstPara && firstPara.type === "paragraph") return firstPara.text.slice(0, 60);
  return "Untitled book";
}

export function guessLanguage(text: string): string {
  if (/[\u0900-\u097F]/.test(text)) return "mr-or-hi"; // Devanagari
  if (/[\u4e00-\u9fff]/.test(text)) return "zh";
  if (/[\u3040-\u30ff]/.test(text)) return "ja";
  if (/[\uac00-\ud7af]/.test(text)) return "ko";
  return "en";
}

function emptyBook(opts: PipelineOptions): Book {
  return {
    schemaVersion: BOOK_SCHEMA_VERSION,
    meta: {
      title: opts.title || "Untitled book",
      authors: opts.authors ?? [],
      language: opts.language || "en",
      sourceProvider: opts.sourceProvider ?? "unknown",
      createdAt: new Date().toISOString(),
    },
    theme: { id: "paper", name: "Paper" },
    blocks: [],
    chapters: [],
  };
}

