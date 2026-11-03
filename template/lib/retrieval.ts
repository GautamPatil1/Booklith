/**
 * Server-side lexical retrieval (TF-IDF-style) over the book's paragraphs.
 * Deliberately dependency-free: works with any book size on a serverless
 * function without an embedding key. Pinned paragraphs are always injected
 * as TOP-PRIORITY context by the caller.
 */

import type { Block, Book } from "./booklith";

export interface Scored {
  id: string;
  text: string;
  score: number;
}

const STOP = new Set(
  "the a an and or but if then of to in on for with as by at from is are was were be been it its this that these those not no what which who whom how why when where".split(" "),
);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(new RegExp("[^\\p{L}\\p{N}\\s$]", "gu"), " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

export function buildIndex(book: Book) {
  const paras = book.blocks.filter((b) => b.type === "paragraph" || b.type === "heading") as Extract<Block, { text: string }>[];
  const docs = paras.map((b) => ({ id: b.id, tokens: tokenize(b.text), text: b.text }));
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d.tokens)) df.set(t, (df.get(t) || 0) + 1);
  const N = Math.max(1, docs.length);
  return {
    docs,
    search(query: string, k = 8, exclude?: Set<string>): Scored[] {
      const q = tokenize(query);
      const scored: Scored[] = [];
      for (const d of docs) {
        if (exclude?.has(d.id)) continue;
        let s = 0;
        let covered = 0; // distinct query terms present — dominates the ranking
        const counts = new Map<string, number>();
        for (const t of d.tokens) counts.set(t, (counts.get(t) || 0) + 1);
        for (const t of q) {
          const c = counts.get(t);
          if (!c) continue;
          covered++;
          const idf = Math.log(1 + N / (1 + (df.get(t) || 0)));
          // capped raw term frequency: no doc-length normalization, which
          // would otherwise rank 3-word dialogue fragments above real paragraphs
          s += Math.min(c, 3) * idf;
        }
        // mild length dampener only, so long paragraphs don't always win either
        s = covered * 1000 + s / (1 + d.tokens.length / 400);
        if (s > 0) scored.push({ id: d.id, text: d.text, score: s });
      }
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, k);
    },
    byIds(ids: string[]): Scored[] {
      const set = new Set(ids);
      return docs.filter((d) => set.has(d.id)).map((d) => ({ id: d.id, text: d.text, score: 99 }));
    },
  };
}
