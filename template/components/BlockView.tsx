"use client";

/**
 * BlockView — renders one block with hover actions:
 *  - 📌 pin as chat context (top priority in the AI sidebar)
 *  - 🌐 translate: the paragraph text swaps IN PLACE; an "EN ↔ lang" switch
 *    lets the reader flip between original and translation — TTS then reads
 *    whatever is on screen, and translations are cached in localStorage.
 *  - 🔊 read aloud via the Modal OmniVoice TTS proxy; audio blobs are cached
 *    in IndexedDB, ↻ regenerates (replaces the cache) on demand.
 */

import { useRef, useState } from "react";
import type { Block } from "../lib/booklith";
import type { Book } from "../lib/booklith";
import { renderInline } from "../lib/inline";
import { translateParagraph, getCachedTranslation } from "../lib/translateCache";
import { ttsGet, ttsPut } from "../lib/cache";
import { getTtsEngine } from "../lib/ttsPreference";
import { getBookVoice } from "../lib/bookVoice";
import { Spinner } from "./Spinner";
import { playFallbackVoice, type FallbackPlayer } from "../lib/fallbackTts";

const LANGS: { code: string; label: string }[] = [
  { code: "en", label: "English" },
  { code: "hi", label: "हिन्दी (Hindi)" },
  { code: "mr", label: "मराठी (Marathi)" },
  { code: "sa", label: "संस्कृत (Sanskrit)" },
  { code: "bn", label: "বাংলা (Bengali)" },
  { code: "ta", label: "தமிழ் (Tamil)" },
  { code: "te", label: "తెలుగు (Telugu)" },
  { code: "kn", label: "ಕನ್ನಡ (Kannada)" },
  { code: "ml", label: "മലയാളം (Malayalam)" },
  { code: "gu", label: "ગુજરાતી (Gujarati)" },
  { code: "pa", label: "ਪੰਜਾਬੀ (Punjabi)" },
  { code: "ur", label: "اردو (Urdu)" },
  { code: "zh", label: "中文 (Chinese)" },
  { code: "ja", label: "日本語 (Japanese)" },
  { code: "ko", label: "한국어 (Korean)" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "it", label: "Italiano" },
  { code: "pt", label: "Português" },
  { code: "ru", label: "Русский" },
  { code: "ar", label: "العربية (Arabic)" },
  { code: "fa", label: "فارسی (Persian)" },
  { code: "he", label: "עברית (Hebrew)" },
  { code: "tr", label: "Türkçe" },
  { code: "nl", label: "Nederlands" },
  { code: "pl", label: "Polski" },
  { code: "id", label: "Bahasa Indonesia" },
  { code: "vi", label: "Tiếng Việt" },
  { code: "th", label: "ไทย (Thai)" },
  { code: "sw", label: "Kiswahili" },
];

interface Props {
  block: Block;
  pinned: boolean;
  onPin: () => void;
  onFlash: (id: string) => void;
  previewMode?: boolean;
  /** the book's language hint, used to pick a matching TTS voice */
  bookLang?: string;
  /** the whole book (title) — used to look up the audiobook "book voice" */
  book?: Book;
}

export function BlockView({ block, pinned, onPin, previewMode, bookLang, book }: Props) {
  const [translation, setTranslation] = useState<{ lang: string; label: string; text: string } | null>(null);
  const [showTranslated, setShowTranslated] = useState(true);
  const [translating, setTranslating] = useState(false);
  const [audioState, setAudioState] = useState<"idle" | "loading" | "playing" | "paused">("idle");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fallbackRef = useRef<FallbackPlayer | null>(null);

  // whatever is on screen right now — translated or original
  const displayedText =
    translation && showTranslated && !translation.text.startsWith("⚠")
      ? translation.text
      : block.type === "paragraph"
        ? block.text
        : "";

  const doTranslate = async (lang: string, langLabel: string) => {
    if (block.type !== "paragraph") return;
    const cached = getCachedTranslation(block.id, lang);
    if (cached) {
      setTranslation({ lang, label: langLabel, text: cached });
      setShowTranslated(true);
      return;
    }
    setTranslating(true);
    try {
      const text = await translateParagraph(block.id, block.text, lang, langLabel);
      setTranslation({ lang, label: langLabel, text });
      setShowTranslated(true);
    } catch (err) {
      setTranslation({ lang, label: langLabel, text: `⚠ ${(err as Error).message}` });
      setShowTranslated(true);
    } finally {
      setTranslating(false);
    }
  };

  const stopAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    fallbackRef.current?.stop();
    fallbackRef.current = null;
    setAudioState("idle");
  };

  const togglePlay = async (regenerate = false) => {
    if (block.type !== "paragraph" || previewMode) return;
    // pause / resume / start
    if (audioState === "playing") {
      audioRef.current?.pause();
      fallbackRef.current?.pause();
      setAudioState("paused");
      return;
    }
    if (audioState === "paused" && (audioRef.current || fallbackRef.current)) {
      if (audioRef.current) await audioRef.current.play();
      else await fallbackRef.current?.resume();
      setAudioState("playing");
      return;
    }
    setAudioState("loading");
    try {
      const text = displayedText.slice(0, 1200);
      const lang = translated ? (translation?.lang ?? "en") : (bookLang || "en");
      // if the user created an audiobook "book voice", use it (clone) — the
      // cache key matches the Audio tab's generated files so 🔊 plays them
      const engine = getTtsEngine();
      const bookVoice = engine === "edge" ? null : book ? getBookVoice(book) : null;
      const voiceSuffix = bookVoice ? ":v" : "";
      const engineSuffix = engine === "auto" || (engine === "omnivoice" && bookVoice) ? "" : `:${engine}`;
      const cacheKey = `${block.id}:${displayedText === block.text ? "orig" : (translation?.lang ?? "")}:${text.length}${voiceSuffix}${engineSuffix}`;
      let played = false;
      if (!regenerate) {
        const blob = await ttsGet(cacheKey);
        if (blob) {
          await playBlob(blob, cacheKey);
          played = true;
        }
      }
      if (!played) {
        // 45s patience: OmniVoice cold starts can take minutes on Modal —
        // rather than keep the reader waiting, switch to the fallback voice.
        let res: Response;
        try {
          res = await fetch("/api/tts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text,
              lang,
              engine,
              ...(bookVoice ? { refAudioB64: bookVoice.seedB64, refText: bookVoice.refText } : {}),
            }),
            signal: AbortSignal.timeout(45_000),
          });
        } catch (err) {
          if (engine !== "auto") throw err;
          fallbackRef.current?.stop();
          fallbackRef.current = playFallbackVoice(text, lang, () => {
            fallbackRef.current = null;
            setAudioState("idle");
          });
          setAudioState("playing");
          return;
        }
        const contentType = res.headers.get("content-type") ?? "";
        if (res.ok && contentType.startsWith("audio/")) {
          const blob = await res.blob();
          void ttsPut(cacheKey, blob);
          await playBlob(blob, cacheKey);
        } else if (res.ok) {
          // server signaled { fallback: "client" } — use the browser voice
          const data = (await res.json()) as { fallback?: string };
          if (data.fallback === "client") {
            if (engine !== "auto") throw new Error(`${engine === "edge" ? "Edge TTS" : "OmniVoice"} is unavailable.`);
            fallbackRef.current?.stop();
            fallbackRef.current = playFallbackVoice(text, lang, () => {
              fallbackRef.current = null;
              setAudioState("idle");
            });
            setAudioState("playing");
          } else {
            throw new Error("TTS service returned no audio");
          }
        } else {
          const err = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as { error?: string };
          throw new Error(err.error || `HTTP ${res.status}`);
        }
      }
    } catch (err) {
      alert(`TTS error: ${(err as Error).message}`);
      setAudioState("idle");
    }
  };

  const playBlob = async (blob: Blob, cacheKey: string) => {
    void cacheKey; // cache already stored by the caller
    audioRef.current?.pause();
    fallbackRef.current?.stop();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.onended = () => {
      URL.revokeObjectURL(url);
      audioRef.current = null;
      setAudioState("idle");
    };
    setAudioState("playing");
    await audio.play();
  };

  if (block.type === "heading") {
    return (
      <h3 className={`bl-heading l${block.level}`} id={block.id}>
        {renderInline(block.text, block.id)}
        {block.page != null && <span className="bl-page">p.{block.page}</span>}
      </h3>
    );
  }

  if (block.type === "figure") {
    return (
      <figure className="bl-figure" id={block.id}>
        <div>🖼 {block.placeholder}</div>
        {block.caption && <figcaption>{block.caption}</figcaption>}
      </figure>
    );
  }

  if (block.type === "table") {
    return (
      <div id={block.id}>
        <MarkdownTable markdown={block.markdown} />
      </div>
    );
  }

  // paragraph — translation swaps IN PLACE; flip with the "orig ↔ lang" switch
  const translated = translation !== null && showTranslated && !translation.text.startsWith("⚠");

  return (
    <p className={`bl-para ${pinned ? "pinned" : ""} ${translated ? "translated" : ""} ${audioState !== "idle" || translating ? "busy" : ""}`} id={block.id}>
      {translated ? renderInline(translation!.text, `${block.id}-tr`) : renderInline(block.text, block.id)}
      {block.page != null && <span className="bl-page">p.{block.page}</span>}
      <span className="bl-actions">
        <button className={pinned ? "on" : ""} title={pinned ? "Unpin from AI context" : "Pin as top-priority AI context"} onClick={onPin}>
          {pinned ? "Pinned" : "Pin"}
        </button>
        <span className="sep" />
        {translation && !translation.text.startsWith("⚠") && (
          <button className="bl-switch" title={`Switch between the original and ${translation.label}`} onClick={() => setShowTranslated((v) => !v)}>
            {showTranslated ? "Original" : translation.label.split(" ")[0]}
          </button>
        )}
        <select
          className="bl-lang"
          title="Translate this paragraph (cached after the first time)"
          defaultValue=""
          onChange={(e) => {
            const lang = e.target.value;
            if (lang) doTranslate(lang, e.target.selectedOptions[0].text);
            e.target.value = "";
          }}
          disabled={translating}
        >
          <option value="" disabled>{translating ? "Translating…" : "Translate ▾"}</option>
          {LANGS.map((l) => (
            <option key={l.code} value={l.code}>{l.label}</option>
          ))}
        </select>
        <span className="sep" />
        <button
          className={audioState === "playing" || audioState === "paused" ? "on" : ""}
          title={audioState === "playing" ? "Pause" : audioState === "paused" ? "Resume" : "Read aloud what's on screen"}
          onClick={() => togglePlay(false)}
          disabled={audioState === "loading"}
        >
          {audioState === "loading" ? <><Spinner size={12} /> Loading</> : audioState === "playing" ? "⏸ Pause" : audioState === "paused" ? "▶ Resume" : "Listen"}
        </button>
        {(audioState === "playing" || audioState === "paused") && (
          <button title="Stop and rewind" onClick={stopAudio}>⏹</button>
        )}
        {!previewMode && audioState === "idle" && (
          <button className="bl-regen" title="Regenerate audio (replaces the cached clip)" onClick={() => togglePlay(true)}>↻</button>
        )}
      </span>
      {translation?.text.startsWith("⚠") && <span className="bl-translation" role="alert">{translation.text}</span>}
    </p>
  );
}

/** Render a GitHub-flavoured markdown table (rows of |a|b|) as a real table. */
export function MarkdownTable({ markdown }: { markdown: string }) {
  const rows = markdown
    .split("\n")
    .map((r) => r.trim())
    .filter((r) => r.startsWith("|"))
    .map((r) => r.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim()));
  const hasHeader = rows.length >= 2 && rows[1].every((c) => /^:?-{2,}:?$/.test(c) || c === "");
  const header = hasHeader ? rows[0] : [];
  const body = hasHeader ? rows.slice(2) : rows;
  return (
    <table className="bl-table">
      {header.length > 0 && (
        <thead>
          <tr>{header.map((c, i) => <th key={i}>{c}</th>)}</tr>
        </thead>
      )}
      <tbody>
        {body.map((r, i) => (
          <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}
