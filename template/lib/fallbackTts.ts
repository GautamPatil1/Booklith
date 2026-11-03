"use client";

/**
 * Client-side fallback voice — used when neither OmniVoice (Modal) nor the
 * Edge Read-Aloud voices are reachable. Plays through the keyless Google
 * Translate TTS endpoint directly from the browser via <audio> elements
 * (media playback needs no CORS), chunked to the endpoint's ~200-char limit
 * and played sentence-by-sentence sequentially.
 */

export interface FallbackPlayer {
  pause(): void;
  resume(): Promise<void>;
  stop(): void;
}

function chunkText(text: string, max = 190): string[] {
  const sentences = text.replace(/\s+/g, " ").match(/[^.!?।。！？]+[.!?।。！？]*\s*/g) ?? [text];
  const chunks: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if ((cur + s).length > max && cur) {
      chunks.push(cur.trim());
      cur = s;
    } else {
      cur += s;
    }
    while (cur.length > max * 2) {
      chunks.push(cur.slice(0, max * 2).trim());
      cur = cur.slice(max * 2);
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks.filter(Boolean);
}

export function playFallbackVoice(text: string, lang: string, onEnded: () => void): FallbackPlayer {
  const chunks = chunkText(text);
  const audios = chunks.map((c, i) => {
    const a = new Audio(
      `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(c)}&tl=${encodeURIComponent(lang)}&client=tw-ob&total=${chunks.length}&idx=${i}&textlen=${c.length}`,
    );
    a.preload = "auto";
    return a;
  });
  let idx = 0;
  let stopped = false;

  const playFrom = async (i: number) => {
    if (stopped || i >= audios.length) {
      if (!stopped) onEnded();
      return;
    }
    idx = i;
    audios[i].onended = () => {
      void playFrom(i + 1);
    };
    audios[i].onerror = () => {
      if (!stopped) onEnded(); // don't hard-fail the reader on a flaky fallback
    };
    try {
      await audios[i].play();
    } catch {
      if (!stopped) onEnded();
    }
  };

  void playFrom(0);

  return {
    pause() {
      audios[idx]?.pause();
    },
    async resume() {
      try {
        await audios[idx]?.play();
      } catch {
        onEnded();
      }
    },
    stop() {
      stopped = true;
      for (const a of audios) {
        a.onended = null;
        a.onerror = null;
        a.pause();
      }
    },
  };
}
