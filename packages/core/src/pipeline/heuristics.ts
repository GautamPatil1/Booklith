/**
 * Noise heuristics for OCR'd book pages.
 *
 * Designed against REAL output from Baidu Unlimited-OCR-2 (see
 * modal/ocr-test-output.md): pages separated by `<!-- page break -->`,
 * bare page-number lines ("2", "38", "(१)"), running headers/footers that
 * repeat across pages, and paragraphs emitted as single long lines.
 */

/** Characters that end a sentence across scripts we expect. */
const TERMINALS = new Set([".", "!", "?", "।", "॥", "؟", "。", "！", "？", "…", '"', "”", "»", ")", "]", "}", ":", ";"]);

/** Devanagari + Arabic-Indic digit ranges, plus ASCII digits. */
const DIGIT_RE = /^[\d\u0660-\u0669\u06f0-\u06f9\u0966-\u096f]+$/;

const ROMAN_RE = /^[ivxlcdm]+$/i;

/** Page numbers may be bare or parenthesised: "12", "१२", "(xiv)", "- 3 -". */
export function isPageNumber(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 12) return false;
  const stripped = t
    .replace(/^[\[\(\{«"'\-\s]+/, "")
    .replace(/[\]\)»"'\-\s]+$/, "");
  if (!stripped) return false;
  if (DIGIT_RE.test(stripped)) return true;
  if (ROMAN_RE.test(stripped) && stripped.length <= 5) return true;
  return false;
}

/** Normalize for repeat-detection: collapse whitespace, strip punctuation noise. */
function repeatKey(line: string): string {
  return line
    .toLowerCase()
    .replace(/[\s\u00a0]+/g, " ")
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .trim();
}

/**
 * Detect running headers/footers: lines at the top or bottom of a page whose
 * normalized form repeats on many pages. Returns the set of repeat-keys.
 *
 * @param pages each page's lines
 */
export function findRunningHeaders(pages: string[][]): Set<string> {
  const counts = new Map<string, number>();
  // Look at the first/last TWO lines of each page: real OCR output puts a
  // page number above/below the running header.
  const EDGE = 2;
  for (const lines of pages) {
    const edges = [...lines.slice(0, EDGE), ...lines.slice(Math.max(0, lines.length - EDGE))];
    const seen = new Set<string>();
    for (const line of edges) {
      const key = repeatKey(line);
      if (!key || key.length < 3 || key.length > 80) continue;
      if (!seen.has(key)) {
        seen.add(key);
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
  }
  const noise = new Set<string>();
  if (pages.length >= 3) {
    for (const [key, count] of counts) {
      if (count >= Math.max(2, Math.ceil(pages.length * 0.4))) noise.add(key);
    }
  }
  return noise;
}

export function isRunningHeader(line: string, noise: Set<string>): boolean {
  const key = repeatKey(line);
  return key.length > 0 && noise.has(key);
}

/**
 * Heading candidate: markdown heading, numbered/keyworded lines, "(N)"-marked
 * titles, or a short standalone line without terminal punctuation.
 *
 * `nextLine` (when provided) demotes obvious hard-wrap artifacts, and
 * `prevLine` promotes "(N)"-marked titles (a common OCR'd chapter pattern).
 *
 * IMPORTANT: the generic "short line, no terminal punctuation" rule fires ONLY
 * for Latin-script lines starting with an uppercase letter — OCR of scripts
 * like Devanagari routinely drops sentence punctuation, which would otherwise
 * turn half the book into headings (observed on real OCR-2 output).
 */
export function looksLikeHeading(line: string, nextLine?: string, prevLine?: string): false | { level: 1 | 2 | 3 } {
  const t = line.trim();
  const md = /^(#{1,3})\s+(.+)$/.exec(t);
  if (md) return { level: md[1].length as 1 | 2 | 3 };
  if (t.length < 4 || t.length > 90) return false;
  // must not end with sentence-terminal punctuation (allow closing quotes)
  const bare = t.replace(/["”'’)\]]+$/, "");
  if (bare.length && TERMINALS.has(bare[bare.length - 1])) return false;
  // "(N)" marker on the previous line -> this is a numbered chapter/section title
  if (prevLine !== undefined && /^\([\d\u0966-\u096f]{1,3}\)$/.test(prevLine.trim())) return { level: 1 };
  // definite heading signals
  if (/^(?:chapter|part|section|appendix)\b/i.test(t)) return { level: 1 };
  // numbered headings: "1. Intro", "१. प्रस्तावना", and ROMAN numerals
  // ("I. A SCANDAL IN BOHEMIA") — a period after a Roman numeral must not
  // disqualify the line (classic Gutenberg story titles).
  if (/^(?:[\d\u0966-\u096f]{1,3}|[IVXLC]{1,5})[.)\s—-]+\S/.test(t) && !/\s{2,}/.test(t)) return { level: 2 };
  // Generic short line with no terminal punctuation — Latin scripts only, and
  // not when the next line looks like its continuation (hard wrap).
  if (t.split(/\s+/).length <= 12 && !/[.;।]/.test(t) && /^[A-ZÀ-Þ]/.test(t)) {
    if (nextLine !== undefined && /^[a-zà-ÿ]/.test(nextLine.trim())) return false;
    return { level: 2 };
  }
  return false;
}

/** Should `next` be joined onto `prev` (a hard line-wrap inside one paragraph)? */
export function shouldJoin(prev: string, next: string): boolean {
  const p = prev.trim();
  const n = next.trim();
  if (!p || !n) return false;
  // Hyphenated wrap: "some-" + "thing"
  if (/[-\u2010\u2011]$/.test(p)) return true;
  const bare = p.replace(/["”'’)\]]+$/, "");
  if (bare.length && TERMINALS.has(bare[bare.length - 1])) return false;
  // ONLY join clear Latin-script hard wraps: next line starts with a lowercase
  // ASCII/Latin-1 letter. OCR-2 emits one paragraph per line in scripts
  // without case (Devanagari, CJK) and often drops sentence punctuation, so
  // joining there would silently merge distinct paragraphs.
  if (/^[a-zà-ÿā-žæøå]/.test(n)) return true;
  return false;
}
