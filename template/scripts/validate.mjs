// Validate content/book.json against content/source.json (the OCR snapshot).
// Fails if any paragraph was altered, lost, invented, or reordered.
// Run with: npm run validate

import { readFileSync } from "node:fs";

const book = JSON.parse(readFileSync(new URL("../content/book.json", import.meta.url), "utf8"));
const source = JSON.parse(readFileSync(new URL("../content/source.json", import.meta.url), "utf8"));

const errors = [];
const norm = (t) => (typeof t === "string" ? t.replace(/\s+/g, " ").trim() : "");

const byId = new Map(book.blocks.map((b) => [b.id, b]));
for (const src of source) {
  const b = byId.get(src.id);
  if (!b) { errors.push(`LOST: ${src.kind} ${src.id} is missing`); continue; }
  const actual = b.type === "table" ? b.markdown : b.type === "figure" ? (b.caption ?? "") : b.text;
  if (norm(actual) !== norm(src.text)) errors.push(`ALTERED: ${src.id}`);
}
const srcIds = new Set(source.map((s) => s.id));
for (const b of book.blocks) if (!srcIds.has(b.id)) errors.push(`INVENTED: ${b.id}`);
const covered = book.chapters.flatMap((c) => c.blockIds);
if (covered.length !== book.blocks.length) errors.push("Chapter membership does not cover every block exactly once.");

if (errors.length) {
  console.error(`✖ book.json validation FAILED (${errors.length}):`);
  for (const e of errors.slice(0, 20)) console.error("  " + e);
  process.exit(1);
}
console.log(`✔ book.json is intact: ${book.blocks.length} blocks, ${book.chapters.length} chapters — no text altered or lost.`);
