/**
 * Build the committed sample book from fresh OCR output (run against the
 * LIVE Modal OCR-2 endpoint — see modal/). Usage:
 *   npx tsx scripts/make-sample.ts <ocr-markdown.md>
 * Writes sample/book.json + sample/source.json and copies them into
 * template/content/ so the reader template runs out of the box.
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { markdownToBook, validateBook } from "../packages/core/src/index.js";

const input = process.argv[2] ?? "/tmp/ocr-fresh-output.md";
const markdown = readFileSync(input, "utf8");

const { book, source, warnings } = markdownToBook(markdown, {
  title: "विनोबा (Vinoba)", // from the OCR title page
  authors: [],
  language: "mr",
  sourceProvider: "baidu-ocr2-modal",
});

// The sample demo doesn't run the AI harness; use a sensible preset theme.
book.theme = { id: "sepia", name: "Sepia" };
book.meta.description = "Sample book built from real Baidu Unlimited-OCR-2 output on a 60-page Marathi PDF (committed so the demo works even if OCR is down).";

const v = validateBook(book, source);
if (!v.ok) {
  console.error("Validation failed:", v.errors);
  process.exit(1);
}

const dir = "sample/vinoba";
mkdirSync(dir, { recursive: true });
mkdirSync("template/content", { recursive: true });
mkdirSync("builder/public/sample", { recursive: true });
writeFileSync(`${dir}/book.json`, JSON.stringify(book, null, 2));
writeFileSync(`${dir}/source.json`, JSON.stringify(source, null, 2));
writeFileSync(`${dir}/ocr-markdown.md`, markdown);
// NOTE: template/content + the default builder sample are the SHERLOCK book
// (scripts/convert-gutenberg.ts). The Marathi sample stays available as an
// OCR-provenance demo; to make it the template's dev book, copy these files
// to template/content/ manually.
copyFileSync(`${dir}/book.json`, "builder/public/sample/vinoba.book.json");
copyFileSync(`${dir}/source.json`, "builder/public/sample/vinoba.source.json");

console.log(`✔ sample book: ${book.blocks.length} blocks, ${book.chapters.length} chapters, ${source.length} source paragraphs — validator green`);
console.log("warnings:", warnings);
