import { BaiduOcr2ModalProvider } from "./baidu-ocr2-modal.js";
import { PasteMarkdownProvider } from "./paste.js";
import type { OcrProvider } from "./provider.js";

export { BaiduOcr2ModalProvider, PasteMarkdownProvider };
export type { OcrProvider, OcrResult, OcrRunInput, OcrConfigField } from "./provider.js";
export { OcrError } from "./provider.js";

/** Registry — the builder renders config fields from these. */
export const OCR_PROVIDERS: OcrProvider[] = [BaiduOcr2ModalProvider, PasteMarkdownProvider];

export function getOcrProvider(id: string): OcrProvider | undefined {
  return OCR_PROVIDERS.find((p) => p.id === id);
}
