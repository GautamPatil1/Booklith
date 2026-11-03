import { OcrError, type OcrProvider, type OcrResult, type OcrRunInput } from "./provider.js";

/**
 * Baidu Unlimited-OCR-2 served on the user's own Modal deployment.
 *
 * Contract (verified against the deployed service, see /modal):
 *   POST <user's parse_pdf URL>  multipart/form-data
 *     pdf:  the PDF file       (required)
 *     dpi:  rasterization dpi  (default 300)
 *   -> 200 text/markdown, pages separated by `<!-- page break -->`
 *
 * The endpoint is public/CORS-enabled (Modal proxies with
 * `access-control-allow-origin: <origin>`), so the browser calls it
 * DIRECTLY — the PDF never touches Booklith or Vercel.
 *
 * Cold start is ~1–3 min (GPU weights load); we surface that in the UI.
 */

export const BaiduOcr2ModalProvider: OcrProvider = {
  id: "baidu-ocr2-modal",
  label: "Baidu Unlimited-OCR-2 (your Modal deployment)",
  description:
    "POSTs your PDF straight from this browser to your own Modal OCR endpoint and gets back clean Markdown. " +
    "Best for English and Chinese. Cold start can take 1–3 minutes.",
  needsFile: true,
  configFields: [
    {
      key: "url",
      label: "Modal OCR URL (parse_pdf endpoint)",
      type: "text",
      placeholder: "https://<workspace>--...-parse-pdf.us-east.modal.run",
      required: true,
      help: "From `modal deploy modal/ocr2_modal.py` (or ocr2_sglang_modal.py). The URL printed as `parse_pdf`.",
    },
    {
      key: "dpi",
      label: "Rasterization DPI",
      type: "number",
      default: "300",
      help: "300 is the sweet spot for typical scans.",
    },
  ],
  async run(input: OcrRunInput): Promise<OcrResult> {
    const url = (input.config.url || "").trim();
    if (!url) throw new OcrError("Modal OCR URL is required.");
    if (!/^https:\/\/.+/.test(url)) throw new OcrError("Modal OCR URL must be an https:// URL.");
    if (!input.file) throw new OcrError("Upload a PDF first.");
    if (input.file.type && input.file.type !== "application/pdf" && !input.file.name.toLowerCase().endsWith(".pdf")) {
      throw new OcrError("Please choose a PDF file.");
    }

    const dpi = Math.max(72, Math.min(600, parseInt(input.config.dpi || "300", 10) || 300));

    input.onProgress?.("Uploading PDF to your Modal OCR service… (first run after idle may take 1–3 min: GPU cold start)");

    // Modal's proxy occasionally answers 303 with a retry token ("modal-http:
    // bad redirect method" if followed naively — see modal/README.md). Browsers
    // downgrade 303 POSTs to GET, so a retried fresh POST is the robust path.
    let lastErr: Error | null = null;
    let resp: Response | null = null;
    let lastBody = "";
    for (let attempt = 1; attempt <= 3 && !resp; attempt++) {
      const form = new FormData();
      form.append("pdf", input.file, input.file.name || "book.pdf");
      form.append("dpi", String(dpi));
      try {
        const r = await fetch(url, { method: "POST", body: form, signal: input.signal });
        if (r.ok) {
          resp = r;
          break;
        }
        lastBody = await r.text().catch(() => "");
        // Modal's 303 retry-redirect surfaces here as 400 "bad redirect method"
        const retryable = r.status >= 500 || (r.status === 400 && /bad redirect/i.test(lastBody));
        lastErr = new OcrError(`OCR service returned HTTP ${r.status} (attempt ${attempt}).`);
        if (!retryable) {
          resp = null;
          throw new OcrError(
            `OCR service returned HTTP ${r.status}: ${lastBody.slice(0, 500)}`,
            r.status === 400 ? "Check that this is the parse_pdf endpoint of `ocr2_modal.py` / `ocr2_sglang_modal.py`." : undefined,
          );
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") throw err;
        if (err instanceof OcrError) throw err;
        lastErr = err as Error;
      }
      if (attempt < 3) {
        input.onProgress?.(`Modal proxy hiccup (attempt ${attempt}) — retrying…`);
        await new Promise((r) => setTimeout(r, 3000 * attempt));
      }
    }
    if (!resp) {
      throw new OcrError(
        `Could not complete OCR after retries: ${lastErr?.message ?? "unknown error"} ${lastBody.slice(0, 200)}`,
        "Check the URL, and that your Modal app is deployed (`modal deploy modal/ocr2_modal.py`).",
      );
    }

    const markdown = await resp.text();
    if (!markdown.trim()) throw new OcrError("OCR service returned empty output.", "The PDF may have no readable pages.");
    const pages = markdown.split(/<!--\s*page break\s*-->/).length;
    input.onProgress?.(`OCR complete: ~${pages} page(s) recognized.`);
    return { markdown, pages };
  },
};
