import assert from "node:assert/strict";
import { test } from "node:test";
import { markdownToBook } from "./pipeline/markdownToBook.js";
import { validateBook } from "./pipeline/validator.js";
import { applyChapters } from "./harness/structure.js";
import type { Book } from "./types.js";

const SAMPLE_MD = `# Chapter One

It was the best of times, it was
the worst of times.

Second paragraph ends here.

<!-- page break -->

12

Chapter One

Third paragraph continues on page two.

<!-- page break -->

13

Chapter One

Fourth paragraph, last page.

## 2. A Section

Math like $x^2$ inline, and a table:

| a | b |
|---|---|
| 1 | 2 |
`;

test("pipeline: splits pages, strips page numbers & running headers, assigns stable ids", () => {
  const { book, source, warnings } = markdownToBook(SAMPLE_MD, { title: "Tale", sourceProvider: "paste" });
  const paras = book.blocks.filter((b) => b.type === "paragraph");
  const headings = book.blocks.filter((b) => b.type === "heading");
  const tables = book.blocks.filter((b) => b.type === "table");

  // wrapped lines joined into one paragraph
  assert.equal(paras.length, 5, `expected 5 paragraphs, got ${paras.map((p) => (p as { text: string }).text)}`);
  const p0 = paras[0] as { id: string; text: string; page: number };
  assert.equal(p0.text, "It was the best of times, it was the worst of times.");
  assert.match(p0.id, /^p-\d{4}$/);
  assert.equal(p0.page, 1);

  // page numbers "12"/"13" and repeated running header dropped (but the
  // genuine "# Chapter One" on page 1 survives)
  const texts = paras.map((p) => (p as { text: string }).text);
  assert.ok(!texts.some((t) => t === "12"));
  assert.ok(!texts.some((t) => t === "13"));
  assert.equal(headings.length, 2, `headings: ${headings.map((h) => (h as { text: string }).text)}`);
  assert.equal((headings[0] as { text: string }).text, "Chapter One");
  assert.equal(tables.length, 1);
  assert.equal((tables[0] as { page: number }).page, 3);

  // validator passes on the fresh build
  assert.ok(validateBook(book, source).ok);

  // deterministic ids
  const again = markdownToBook(SAMPLE_MD, { title: "Tale", sourceProvider: "paste" });
  assert.deepEqual(again.book.blocks.map((b) => b.id), book.blocks.map((b) => b.id));
  assert.ok(warnings.length >= 0);
});

test("validator: detects altered and lost paragraphs", () => {
  const { book, source } = markdownToBook(SAMPLE_MD, { title: "Tale" });
  const tampered: Book = JSON.parse(JSON.stringify(book));
  (tampered.blocks[1] as { text: string }).text = "AI rewrote this!";
  let v = validateBook(tampered, source);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.startsWith("ALTERED:")));

  const lost: Book = JSON.parse(JSON.stringify(book));
  lost.blocks.splice(2, 1);
  v = validateBook(lost, source);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.startsWith("LOST:")));

  const invented: Book = JSON.parse(JSON.stringify(book));
  invented.blocks.push({ id: "p-9999", type: "paragraph", text: "hallucinated" } as never);
  v = validateBook(invented, source);
  assert.ok(v.errors.some((e) => e.startsWith("INVENTED:")));
});

test("harness: applyChapters keeps text identical and validator green", () => {
  const { book, source } = markdownToBook(SAMPLE_MD, { title: "Tale" });
  const ids = book.blocks.map((b) => b.id);
  const structured = applyChapters(book, {
    title: "A Tale",
    description: "d",
    language: "en",
    chapters: [
      { title: "Beginning", startId: ids[0], endId: ids[1] },
      { title: "Rest", startId: ids[2], endId: ids[ids.length - 1] },
    ],
  });
  const v = validateBook(structured, source);
  assert.ok(v.ok, JSON.stringify(v.errors));
  assert.equal(structured.chapters.length, 2);
  assert.equal(structured.meta.title, "A Tale");
  // text untouched
  assert.deepEqual(
    structured.blocks.map((b) => (b.type === "paragraph" || b.type === "heading" ? b.text : b.markdown ?? b.caption)),
    book.blocks.map((b) => (b.type === "paragraph" || b.type === "heading" ? b.text : b.markdown ?? b.caption)),
  );
});

test("pipeline: (N) markers promote real chapter titles (real OCR-2 pattern)", () => {
  const md = [
    "Front paragraph ends here.",
    "",
    "<!-- page break -->",
    "",
    "12",
    "",
    "(१)",
    "शिवरांची शुण्योमिता",
    "First paragraph of the chapter.",
    "",
    "(3)",
    "दुसरी गोष्ट",
    "Second chapter body.",
  ].join("\n");
  const { book, source } = markdownToBook(md, { title: "T" });
  const h1s = book.blocks.filter((b) => b.type === "heading" && b.level === 1);
  assert.equal(h1s.length, 2, JSON.stringify(book.blocks));
  const titles = h1s.map((b) => (b as { text: string }).text);
  assert.deepEqual(titles, ["शिवरांची शुण्योमिता", "दुसरी गोष्ट"]);
  assert.equal(book.chapters.length, 3); // front matter + 2 marked chapters
  assert.ok(validateBook(book, source).ok);
});

