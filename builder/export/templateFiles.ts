import type { Book, SourceText } from "@booklith/core";
import { TEMPLATE_FILES } from "./generated-template";

/**
 * Materialize the exported reader app as a plain file map, injecting the
 * user's book. Runs entirely in the browser — nothing touches a server.
 */

export interface ReaderOptions {
  /**
   * Optional OmniVoice Modal TTS URL (omnivoice_tts_modal.py's POST endpoint).
   * When provided it is committed to the repo as content/tts-url.json so
   * read-aloud works out of the box; the MODAL_TTS_URL env var still wins
   * at runtime.
   */
  ttsUrl?: string;
}

export function generateReaderFiles(book: Book, source: SourceText[], options: ReaderOptions = {}): Record<string, string> {
  const files: Record<string, string> = {};
  const ttsUrl = options.ttsUrl?.trim() || null;
  for (const [path, content] of Object.entries(TEMPLATE_FILES)) {
    switch (content) {
      case "__BOOKLITH_BOOK_JSON__":
        files[path] = JSON.stringify(book, null, 2);
        break;
      case "__BOOKLITH_SOURCE_JSON__":
        files[path] = JSON.stringify(source, null, 2);
        break;
      default:
        files[path] = content;
    }
  }
  files["content/tts-url.json"] = JSON.stringify({ url: ttsUrl, note: "Optional default TTS endpoint; set by the Builder. MODAL_TTS_URL env var overrides this at runtime." }, null, 2);
  return files;
}

export function totalBytes(files: Record<string, string>): number {
  return Object.values(files).reduce((s, c) => s + c.length, 0);
}
