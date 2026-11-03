import type { OcrProvider, OcrResult, OcrRunInput } from "./provider.js";
import { OcrError } from "./provider.js";

/**
 * Fallback provider: paste markdown (or any text) directly.
 * Useful when OCR struggles (weak languages) and the user has text elsewhere,
 * and for quick demos without deploying anything.
 */
export const PasteMarkdownProvider: OcrProvider = {
  id: "paste",
  label: "Paste Markdown / text",
  description:
    "Skip OCR entirely: paste a book as Markdown. Separate pages with `<!-- page break -->` (optional). " +
    "Use headings (`#`, `##`) to mark chapters.",
  needsFile: false,
  configFields: [
    {
      key: "markdown",
      label: "Book text (Markdown)",
      type: "textarea",
      placeholder: "# Chapter 1\n\nIt was the best of times…",
      required: true,
    },
  ],
  async run(input: OcrRunInput): Promise<OcrResult> {
    const markdown = (input.config.markdown || "").trim();
    if (markdown.length < 20) throw new OcrError("Paste at least a few paragraphs of text.");
    return { markdown, pages: markdown.split(/<!--\s*page break\s*-->/).length };
  },
};
