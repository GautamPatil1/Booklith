"use client";

/**
 * Client-side caches so users never pay twice for the same AI work:
 *  - TTS audio: IndexedDB (blobs are too big for localStorage)
 *  - chat history / quizzes: localStorage
 * Everything is keyed per book so multiple books don't collide.
 */

export function bookKey(book: { meta: { title: string } }): string {
  return book.meta.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60) || "book";
}

// ── localStorage helpers ──────────────────────────────────────────────────
export function lsGet<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`booklith:${key}`);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function lsPut(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(`booklith:${key}`, JSON.stringify(value));
  } catch {
    /* quota / private mode — cache miss is acceptable */
  }
}

export function lsDrop(key: string): void {
  try {
    window.localStorage.removeItem(`booklith:${key}`);
  } catch {
    /* ignore */
  }
}

// ── IndexedDB audio cache ──────────────────────────────────────────────────
const DB_NAME = "booklith-tts";
const STORE = "audio";

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

export async function ttsGet(key: string): Promise<Blob | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null);
    req.onerror = () => resolve(null);
  });
}

export async function ttsPut(key: string, blob: Blob): Promise<void> {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}
