/**
 * Convert a Project Gutenberg plain-text book into a Booklith sample through
 * the REAL pipeline + AI harness (Meta AI API — models chosen per task):
 *   structure: muse-wonder-1.0  (premium reasoning — chapter grouping)
 *   theme:      muse-spark-1.3   (fast — preset picking)
 *
 * Usage: npx tsx scripts/convert-gutenberg.ts <gutenberg-txt> <slug> <title> <lang>
 * Reads API_KEY from .env (never committed).
 */

import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { markdownToBook, validateBook, improveStructure, pickTheme, type LlmConfig } from "../packages/core/src/index.js";

const [,, input, slug, titleArg, langArg] = process.argv;
if (!input || !slug) throw new Error("usage: convert-gutenberg.ts <txt> <slug> <title> <lang>");
const TITLE = titleArg ?? "Untitled";
const LANG = langArg ?? "en";

// ── .env loader (root .env only, dev-time) ────────────────────────────────
function loadEnv(path: string): Record<string, string> {
  try {
    const env: Record<string, string> = {};
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = /^([A-Z_0-9]+)=(.*)$/.exec(line.trim());
      if (m) env[m[1]] = m[2];
    }
    return env;
  } catch {
    return {};
  }
}
const env = loadEnv(new URL("../.env", import.meta.url).pathname);
if (!env.API_KEY) throw new Error("API_KEY missing from .env");

const llm: LlmConfig = { baseUrl: "https://api.meta.ai/v1", apiKey: env.API_KEY, model: "muse-wonder-1.0", reasoningEffort: "low" };
const llmFast: LlmConfig = { ...llm, model: "muse-spark-1.3" };

// ── Gutenberg text -> OCR-like markdown ───────────────────────────────────
function gutenbergToMarkdown(raw: string): string {
  let text = raw.replace(/\r\n/g, "\n");
  // cut the FULL "*** START OF ... ***" marker (it can wrap over 2 lines),
  // then the trailing "*** END OF ... ***" marker
  const start = text.indexOf("*** START OF");
  if (start !== -1) {
    const markerEnd = text.indexOf("***", start + 12); // closing *** of the marker
    text = text.slice(markerEnd !== -1 ? markerEnd + 3 : text.indexOf("\n", start) + 1);
  }
  const end = text.indexOf("*** END OF");
  if (end !== -1) text = text.slice(0, end);

  // unwrap hard-wrapped paragraphs: blank-line separated blocks -> one line
  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < blocks.length; i++) {
    let block = blocks[i];
    // TOC blocks: "Contents" followed by many "I. Title" lines — drop
    if (/^contents\b/i.test(block) && (blocks[i + 1] ?? "").match(/(?:[IVXLC]+\.)/g)?.length! >= 4) {
      i++; // skip the joined TOC block too
      continue;
    }
    // unwrap: join wrapped lines, de-hyphenate
    block = block
      .split("\n")
      .reduce((acc, line) => {
        const t = line.trim();
        if (!acc) return t;
        if (/[-\u2010]$/.test(acc)) return acc.slice(0, -1) + t;
        return acc + " " + t;
      }, "");
    // story/chapter headings get a page break, like real OCR pages
    if (/^[IVXLC]{1,5}\.$/.test(block)) {
      out.push("<!-- page break -->"); // standalone "I." marker line -> page boundary
      continue;
    }
    if (/^[IVXLC]{1,5}\.\s+\S/.test(block)) {
      out.push("<!-- page break -->"); // "I. A SCANDAL IN BOHEMIA" style headings
    }
    out.push(block);
  }
  return out.join("\n\n");
}

console.log("→ building Book JSON from pipeline…");
const markdown = gutenbergToMarkdown(readFileSync(input, "utf8"));
const { book, source, warnings } = markdownToBook(markdown, {
  title: TITLE,
  language: LANG,
  sourceProvider: "gutenberg-text",
  authors: [titleArg === "The Adventures of Sherlock Holmes" ? "Arthur Conan Doyle" : ""].filter(Boolean),
});
console.log(`  pipeline: ${book.blocks.length} blocks, ${book.chapters.length} heuristic chapters; warnings: ${warnings.length}`);

async function main(): Promise<void> {
console.log("→ AI harness: improving structure (muse-wonder-1.0)…");
const structured = await improveStructure(book, source, llm);
if (!structured.validation.ok) {
  console.error("  AI structure failed validation:", structured.validation.errors.slice(0, 3));
  process.exit(1);
}
console.log(`  chapters: ${structured.book.chapters.length}`);
structured.notes.forEach((n) => console.log("  · " + n.slice(0, 120)));

console.log("→ AI harness: picking theme (muse-spark-1.3)…");
const { themeId, reason } = await pickTheme(structured.book, llmFast);
console.log(`  theme: ${themeId} — ${reason.slice(0, 100)}`);
structured.book.theme = { id: themeId, name: themeId };

const v = validateBook(structured.book, source);
if (!v.ok) {
  console.error("final validation FAILED:", v.errors.slice(0, 5));
  process.exit(1);
}

// ── write outputs ─────────────────────────────────────────────────────────
const dir = `sample/${slug}`;
mkdirSync(dir, { recursive: true });
mkdirSync("template/content", { recursive: true });
writeFileSync(`${dir}/book.json`, JSON.stringify(structured.book, null, 2));
writeFileSync(`${dir}/source.json`, JSON.stringify(source, null, 2));
mkdirSync("builder/public/sample", { recursive: true });
copyFileSync(`${dir}/book.json`, `builder/public/sample/${slug}.book.json`);
copyFileSync(`${dir}/source.json`, `builder/public/sample/${slug}.source.json`);
copyFileSync(`${dir}/book.json`, "template/content/book.json");
copyFileSync(`${dir}/source.json`, "template/content/source.json");

console.log(`✔ ${slug}: ${structured.book.blocks.length} blocks, ${structured.book.chapters.length} chapters — validator green`);
console.log("chapters:", structured.book.chapters.map((c) => c.title).join(" | "));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
