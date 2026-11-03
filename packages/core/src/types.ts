/**
 * Booklith core types.
 *
 * The Book JSON is the single artifact the whole system produces and ships:
 *   OCR markdown -> pipeline -> Book JSON -> (AI harness reshapes structure)
 *   -> validator -> exported reader app.
 *
 * Design rules:
 *  - Every paragraph / heading / figure / table gets a STABLE ID assigned by
 *    the pipeline (deterministic, order-based). IDs are the citation currency
 *    for chat, quizzes, translations and validation.
 *  - The AI harness may only move blocks into chapters and pick a theme.
 *    It can NEVER add, delete or alter block text. The validator enforces it.
 */

export const BOOK_SCHEMA_VERSION = 1;

export interface BookMeta {
  title: string;
  authors: string[];
  /** BCP-47-ish language hint, e.g. "en", "mr", "zh". */
  language: string;
  description?: string;
  /** id of the OCR provider used, or "paste" / "sample". */
  sourceProvider: string;
  createdAt: string; // ISO 8601
}

/** A theme is always a PRESET from the fixed catalog — the AI only picks the id. */
export interface BookTheme {
  id: string;
  name: string;
}

export interface BlockBase {
  id: string;
  /** 1-based PDF page this block came from, if known. */
  page?: number;
  /** chapter id this block belongs to (filled by structuring step). */
  chapterId?: string;
}

export interface HeadingBlock extends BlockBase {
  type: "heading";
  level: 1 | 2 | 3;
  text: string;
  /** true when the pipeline guessed (vs. markdown `#`) — the AI harness may demote these. */
  tentative?: boolean;
}

export interface ParagraphBlock extends BlockBase {
  type: "paragraph";
  text: string;
}

export interface FigureBlock extends BlockBase {
  type: "figure";
  caption?: string;
  /** Always a placeholder: OCR-2 drops raster images; we never fabricate images. */
  placeholder: string;
}

export interface TableBlock extends BlockBase {
  type: "table";
  /** GitHub-flavoured markdown table (verbatim from OCR). */
  markdown: string;
}

export type Block = HeadingBlock | ParagraphBlock | FigureBlock | TableBlock;

export type Paragraphish = ParagraphBlock | HeadingBlock | TableBlock | FigureBlock;

export interface Chapter {
  id: string;
  title: string;
  /** Ordered block ids belonging to this chapter. */
  blockIds: string[];
}

export interface Book {
  schemaVersion: number;
  meta: BookMeta;
  theme: BookTheme;
  blocks: Block[];
  chapters: Chapter[];
}

/**
 * Source of truth extracted from the OCR markdown, BEFORE any AI touches it.
 * The validator compares the final Book against this, character for character.
 */
export interface SourceText {
  /** id assigned at pipeline time; must survive into the final Book unchanged. */
  id: string;
  /** "paragraph" | "heading" | "table" | "figure" */
  kind: SourceKind;
  /** exact text (paragraph/heading) or markdown (table) or caption (figure). */
  text: string;
  page?: number;
}

export type SourceKind = "paragraph" | "heading" | "table" | "figure";

export interface BuildResult {
  book: Book;
  source: SourceText[];
  warnings: string[];
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/** Compact outline item sent to the AI harness. */
export interface OutlineItem {
  id: string;
  type: Block["type"];
  level?: number;
  text: string; // truncated preview — the model never needs full text for structuring
}
