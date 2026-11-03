/**
 * E2E export test: materialize the exported reader app for the sample book
 * into a directory (default /tmp/exported-book) exactly like the browser
 * export does, then verify the book.json placeholders were substituted.
 *
 *   npx tsx scripts/e2e-export.ts <outdir>
 */
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { generateReaderFiles } from "../builder/export/templateFiles.js";

const out = process.argv[2] ?? "/tmp/exported-book";
const sampleDir = process.argv[3] ?? "sample/sherlock-holmes";
const book = JSON.parse(readFileSync(`${sampleDir}/book.json`, "utf8"));
const source = JSON.parse(readFileSync(`${sampleDir}/source.json`, "utf8"));

const files = generateReaderFiles(book, source);
for (const [path, content] of Object.entries(files)) {
  const full = join(out, path);
  mkdirSync(full.slice(0, full.lastIndexOf("/")), { recursive: true });
  writeFileSync(full, content);
}

const bookOut = JSON.parse(files["content/book.json"]);
console.log(`✔ wrote ${Object.keys(files).length} files to ${out}`);
console.log(`  book.json: ${bookOut.blocks.length} blocks, ${bookOut.chapters.length} chapters, title="${bookOut.meta.title}"`);
console.log(`  .env.example present: ${!!files[".env.example"]}`);
console.log(`  .gitignore present: ${!!files[".gitignore"]}`);
if (bookOut.blocks.length === 0) throw new Error("book.json substitution failed");
