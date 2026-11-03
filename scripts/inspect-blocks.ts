/** Quick pipeline output inspection: npx tsx scripts/inspect-blocks.ts <markdown-or-txt> */
import { readFileSync } from "node:fs";
import { markdownToBook } from "../packages/core/src/index.js";

const md = readFileSync(process.argv[2], "utf8");
const { book, warnings } = markdownToBook(md, { title: "T" });
console.log(`blocks: ${book.blocks.length} | chapters: ${book.chapters.length} | warnings: ${warnings.join("; ")}`);
for (const b of book.blocks.slice(0, 25)) {
  const t = b.type === "table" ? b.markdown : b.type === "figure" ? b.caption ?? "" : b.text;
  console.log(`${b.id} [${b.type}${b.type === "heading" ? ` lvl${(b as { level: number }).level}${(b as { tentative?: boolean }).tentative ? "?" : ""}` : ""}] p${b.page ?? "?"}: ${t.slice(0, 90).replace(/\n/g, " ")}`);
}
console.log("--- all headings:");
for (const b of book.blocks) {
  if (b.type === "heading") console.log(`${b.id} lvl${b.level}${b.tentative ? "?" : ""} p${b.page}: ${b.text.slice(0, 70)}`);
}
