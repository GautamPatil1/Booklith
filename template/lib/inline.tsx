import katex from "katex";
import type { ReactNode } from "react";

/**
 * Render a paragraph's inline markup: math ($...$, $$...$$, \(...\), \[...\])
 * via KaTeX plus minimal bold/italic/code. Everything else is escaped text —
 * we never dangerouslySetInnerHTML raw OCR output.
 */

const MATH_RE = /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\])/;
const BOLD_RE = /\*\*([^*]+)\*\*/;
const ITAL_RE = /(?<!\*)\*([^*\n]+)\*(?!\*)/;
const UNDER_RE = /(?<![\w\\])_([^_\n]+)_(?![\w])/; // Gutenberg-style _italic_
const CODE_RE = /`([^`\n]+)`/;

function renderMath(src: string): string {
  const tex = src
    .replace(/^\$\$|\$\$$/g, "")
    .replace(/^\\\(|\\\)$/g, "")
    .replace(/^\\\[|\\\]$/g, "")
    .trim();
  try {
    return katex.renderToString(tex, { displayMode: src.startsWith("$$") || src.startsWith("\\["), throwOnError: false });
  } catch {
    return `<code>${tex}</code>`;
  }
}

/** Inline markup -> React nodes. Math is KaTeX HTML; all other text is escaped. */
export function renderInline(text: string, keyPrefix = ""): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let k = 0;
  while (rest.length > 0) {
    const mathIdx = rest.search(MATH_RE);
    if (mathIdx !== -1) {
      const m = MATH_RE.exec(rest)!;
      if (mathIdx > 0) out.push(...renderPlain(rest.slice(0, mathIdx), `${keyPrefix}t${k++}`));
      out.push(
        <span key={`${keyPrefix}m${k++}`} dangerouslySetInnerHTML={{ __html: renderMath(m[0]) }} />,
      );
      rest = rest.slice(mathIdx + m[0].length);
    } else {
      out.push(...renderPlain(rest, `${keyPrefix}t${k++}`));
      break;
    }
  }
  return out;
}

/** Minimal markdown inline (bold/italic/code) with proper escaping. */
function renderPlain(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const parts = text.split(/(\*\*[^*]+\*\*|(?<!\*)\*[^*\n]+\*(?!\*)|(?<![\w\\])_[^_\n]+_(?![\w])|`[^`\n]+`)/g);
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p) continue;
    if (BOLD_RE.test(p)) out.push(<strong key={`${keyPrefix}b${i}`}>{p.slice(2, -2)}</strong>);
    else if (ITAL_RE.test(p)) out.push(<em key={`${keyPrefix}i${i}`}>{p.slice(1, -1)}</em>);
    else if (UNDER_RE.test(p)) out.push(<em key={`${keyPrefix}u${i}`}>{p.slice(1, -1)}</em>);
    else if (CODE_RE.test(p)) out.push(<code key={`${keyPrefix}c${i}`}>{p.slice(1, -1)}</code>);
    else out.push(<span key={`${keyPrefix}s${i}`}>{p}</span>);
  }
  return out;
}
