import { buildIndex } from "../template/lib/retrieval.js";
import { readFileSync } from "node:fs";

const book = JSON.parse(readFileSync("sample/sherlock-holmes/book.json", "utf8"));
const index = buildIndex(book as never);
for (const q of [
  "Who is Irene Adler and why does Holmes admire her?",
  "What was the Red-Headed League and what was its real purpose?",
]) {
  console.log("Q:", q);
  for (const h of index.search(q, 5)) console.log("  ", h.id, String(h.score).slice(0, 6), h.text.slice(0, 85));
}
