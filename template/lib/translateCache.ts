"use client";

/**
 * Client-side cache for per-paragraph translations (localStorage, keyed by
 * paragraph id + target language). Also exposes an in-flight dedup so
 * double-clicks don't double-spend API calls.
 */

const PREFIX = "booklith:tr:";

export function cacheKey(id: string, lang: string): string {
  return `${PREFIX}${lang}:${id}`;
}

export function getCachedTranslation(id: string, lang: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(cacheKey(id, lang));
  } catch {
    return null;
  }
}

export function putCachedTranslation(id: string, lang: string, text: string): void {
  try {
    window.localStorage.setItem(cacheKey(id, lang), text);
  } catch {
    /* storage full / private mode — cache miss is acceptable */
  }
}

const inflight = new Map<string, Promise<string>>();

export async function translateParagraph(
  id: string,
  text: string,
  lang: string,
  langLabel: string,
): Promise<string> {
  const cached = getCachedTranslation(id, lang);
  if (cached) return cached;
  const key = cacheKey(id, lang);
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = (async () => {
    const res = await fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, text, lang, langLabel }),
    });
    const data = (await res.json()) as { translation?: unknown; error?: unknown };
    if (!res.ok) {
      throw new Error(
        typeof data.error === "string" ? data.error : `Translation failed (HTTP ${res.status})`,
      );
    }
    if (typeof data.translation !== "string") {
      throw new Error("Translation service returned an invalid response.");
    }
    putCachedTranslation(id, lang, data.translation);
    return data.translation;
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
