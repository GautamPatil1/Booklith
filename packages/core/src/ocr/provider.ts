/**
 * OCR provider interface.
 *
 * WHY an interface: Baidu Unlimited-OCR-2 (our default) is strong for English
 * and Chinese but weak elsewhere. Any OCR engine can be plugged in by
 * implementing this — the rest of the pipeline only sees markdown with
 * `<!-- page break -->` page separators.
 *
 * Providers run IN THE BROWSER. The browser POSTs the PDF directly to the
 * user's own Modal OCR URL (Modal endpoints are CORS-enabled), so large PDFs
 * never transit Vercel (whose request bodies cap at ~4.5 MB) and no key ever
 * leaves the user's machine.
 */

export interface OcrConfigField {
  key: string;
  label: string;
  type: "text" | "password" | "textarea" | "number";
  placeholder?: string;
  required?: boolean;
  help?: string;
  default?: string;
}

export interface OcrRunInput {
  /** The uploaded PDF as a browser File. */
  file?: File;
  /** Raw markdown path (paste provider) — no file needed. */
  markdown?: string;
  config: Record<string, string>;
  signal?: AbortSignal;
  onProgress?: (msg: string) => void;
}

export interface OcrResult {
  /** Markdown with `<!-- page break -->` separators between PDF pages. */
  markdown: string;
  /** Page count, if known. */
  pages?: number;
}

export interface OcrProvider {
  id: string;
  label: string;
  description: string;
  /** true if this provider needs a PDF file upload (vs. pasted text). */
  needsFile: boolean;
  configFields: OcrConfigField[];
  run(input: OcrRunInput): Promise<OcrResult>;
}

export class OcrError extends Error {
  constructor(
    message: string,
    public readonly hint?: string,
  ) {
    super(message);
    this.name = "OcrError";
  }
}
