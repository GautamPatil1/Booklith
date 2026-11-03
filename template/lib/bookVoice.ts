"use client";

/**
 * The "book voice": one seed clip (TTS-generated from the book's own opening)
 * is kept in localStorage and reused as an OmniVoice VOICE CLONE reference
 * for every paragraph's audio. Because the seed's transcript is known, the
 * clone requests carry ref_text — the Modal service then skips its Whisper
 * transcription pass (faster + cheaper per request).
 */

import { lsGet, lsPut, lsDrop, bookKey } from "./cache";

export interface BookVoice {
  /** base64 WAV of the seed clip (3–10 s of speech) */
  seedB64: string;
  /** exact transcript of the seed clip */
  refText: string;
  /** when the seed was generated */
  createdAt: string;
}

function key(book: { meta: { title: string } }): string {
  return `voice:${bookKey(book)}`;
}

export function getBookVoice(book: { meta: { title: string } }): BookVoice | null {
  return lsGet<BookVoice>(key(book));
}

export function setBookVoice(book: { meta: { title: string } }, voice: BookVoice): void {
  lsPut(key(book), voice);
}

export function clearBookVoice(book: { meta: { title: string } }): void {
  lsDrop(key(book));
}

/** Convert a Blob to a base64 string (for the seed clip). */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const s = reader.result as string;
      resolve(s.slice(s.indexOf(",") + 1)); // strip the data: prefix
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
