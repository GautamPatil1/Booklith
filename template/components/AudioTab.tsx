"use client";

/**
 * Audio tab — the audiobook studio.
 *
 * 1. "Create book voice": synthesizes a short seed clip from the book's own
 *    opening (ONE auto-voice call) and stores it locally as the book's voice.
 * 2. "Generate audiobook": walks every paragraph, synthesizing each with the
 *    seed as an OmniVoice VOICE CLONE reference (ref_text supplied, so the
 *    service skips Whisper). Results are cached in IndexedDB — the per-
 *    paragraph 🔊 buttons then play them instantly, and ↻ regenerates any
 *    single paragraph in the same voice later.
 * 3. Progress + cancel; already-cached paragraphs are skipped, so a stopped
 *    run resumes where it left off.
 *
 * In the BUILDER preview the same tab works against the builder's /api/tts
 * using the OmniVoice Modal URL you paste below (bring-your-own, per request).
 */

import { useRef, useState } from "react";
import type { Book } from "../lib/booklith";
import { ttsGet, ttsPut, lsGet, lsPut } from "../lib/cache";
import { getBookVoice, setBookVoice, clearBookVoice, blobToBase64 } from "../lib/bookVoice";
import { getTtsEngine, setTtsEngine, type TtsEngine } from "../lib/ttsPreference";
import { Spinner } from "./Spinner";

const BUILDER_TTS_URL_KEY = "builder-tts-url";

interface Props {
  book: Book;
  previewMode?: boolean;
}

export function AudioTab({ book, previewMode }: Props) {
  const [voice, setVoiceState] = useState(() => getBookVoice(book));
  const [seedBusy, setSeedBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [builderUrl, setBuilderUrl] = useState(() => lsGet<string>(BUILDER_TTS_URL_KEY) ?? "");
  const [ttsEngine, setTtsEngineState] = useState<TtsEngine>(() => getTtsEngine());
  const [gen, setGen] = useState<{ running: boolean; done: number; total: number; current: string }>({ running: false, done: 0, total: 0, current: "" });
  const [message, setMessage] = useState<string | null>(null);
  const cancelRef = useRef(false);

  const paragraphs = book.blocks.filter((b) => b.type === "paragraph") as Extract<Book["blocks"][number], { type: "paragraph" }>[];

  // seed text = the book's first sentence(s), capped so the clip lands in the
  // 3–10 s sweet spot OmniVoice recommends for clones
  const seedText = (() => {
    const first = paragraphs[0]?.text ?? book.meta.title;
    const m = first.match(/[^.!?।]+[.!?।]?/g);
    let s = "";
    for (const part of m ?? [first]) {
      if ((s + part).length > 180) break;
      s += part;
    }
    return s.trim() || first.slice(0, 180);
  })();

  const ttsRequest = async (text: string, opts: { ref?: { seedB64: string; refText: string }; engine?: TtsEngine } = {}) => {
    const payload: Record<string, unknown> = { text, lang: book.meta.language || "en", engine: opts.engine ?? ttsEngine };
    if (opts.ref) {
      payload.refAudioB64 = opts.ref.seedB64;
      payload.refText = opts.ref.refText;
    }
    if (previewMode) payload.ttsUrl = builderUrl.trim(); // builder: BYO endpoint per request
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const contentType = res.headers.get("content-type") ?? "";
    if (res.ok && contentType.startsWith("audio/")) return await res.blob();
    throw new Error((await res.json().catch(() => ({}))).error ?? `TTS failed (HTTP ${res.status})`);
  };

  const createVoice = async () => {
    if (previewMode && !builderUrl.trim()) {
      setMessage("Book voice creation requires your OmniVoice Modal URL.");
      return;
    }
    setSeedBusy(true);
    setMessage(null);
    try {
      const blob = await ttsRequest(seedText, { engine: "omnivoice" });
      const seedB64 = await blobToBase64(blob);
      const v = { seedB64, refText: seedText, createdAt: new Date().toISOString() };
      setBookVoice(book, v);
      setVoiceState(v);
      setPreviewUrl(URL.createObjectURL(blob));
      setMessage("Book voice created. Select OmniVoice (or Automatic with an endpoint) to use it for paragraph playback.");
    } catch (err) {
      setMessage(`⚠ ${(err as Error).message}`);
    } finally {
      setSeedBusy(false);
    }
  };

  const generateAudiobook = async () => {
    if (!voice) {
      setMessage("Create the book voice first.");
      return;
    }
    if (previewMode && !builderUrl.trim()) {
      setMessage("Paste your OmniVoice Modal URL above first.");
      return;
    }
    cancelRef.current = false;
    setGen({ running: true, done: 0, total: paragraphs.length, current: "" });
    setMessage(null);
    let done = 0;
    let failed = 0;
    for (const p of paragraphs) {
      if (cancelRef.current) break;
      const key = `${p.id}:orig:${p.text.slice(0, 1200).length}:v`;
      if (await ttsGet(key)) {
        done++;
        setGen((g) => ({ ...g, done }));
        continue;
      }
      setGen((g) => ({ ...g, current: p.id }));
      try {
        const blob = await ttsRequest(p.text.slice(0, 1200), { ref: voice, engine: "omnivoice" });
        await ttsPut(key, blob);
        done++;
      } catch {
        failed++;
        if (failed >= 3) {
          setMessage("⚠ Stopped after repeated failures — check your Modal endpoint.");
          break;
        }
      }
      setGen((g) => ({ ...g, done }));
    }
    setGen((g) => ({ ...g, running: false, current: "" }));
    if (!cancelRef.current && failed > 0 && failed < 3) setMessage(`Done with ${failed} paragraph(s) failed — re-run to retry them.`);
    else if (done >= paragraphs.length) setMessage("Audiobook complete — every paragraph's 🔊 now plays instantly in your book voice.");
  };

  const removeVoice = () => {
    clearBookVoice(book);
    setVoiceState(null);
    setPreviewUrl(null);
    setMessage("Book voice removed. Paragraphs use the selected read-aloud engine (↻ per paragraph).");
  };


  return (
    <div className="bl-ai-body">
      <p style={{ color: "var(--bl-muted)", fontSize: "0.74rem", lineHeight: 1.5 }}>
        Turn the book into an audiobook in <strong>one consistent voice</strong>: a short seed clip is
        synthesized once, then every paragraph is read in that cloned voice (OmniVoice). Audio is cached in
        your browser — regenerate any single paragraph later with its ↻ button.
      </p>

      <div className="bl-quiz-q bl-tts-settings">
        <div className="q">Paragraph read-aloud</div>
        <label className="bl-tts-choice">
          <span>Engine</span>
          <select
            value={ttsEngine}
            onChange={(event) => {
              const { value } = event.target;
              if (value !== "auto" && value !== "edge" && value !== "omnivoice") return;
              const engine: TtsEngine = value;
              setTtsEngineState(engine);
              setTtsEngine(engine);
            }}
          >
            <option value="auto">Automatic</option>
            <option value="edge">Edge TTS</option>
            <option value="omnivoice">OmniVoice</option>
          </select>
        </label>
        <p style={{ color: "var(--bl-muted)", fontSize: "0.74rem", lineHeight: 1.5, margin: "0.6rem 0 0" }}>
          Edge TTS is the default. Automatic prefers OmniVoice when configured, then Edge TTS. Choosing a
          specific engine does not silently switch providers if it is unavailable. Book-voice cloning and
          audiobook generation use OmniVoice.
        </p>
      </div>

      {previewMode && (
        <input
          className="bl-search-input"
          style={{ maxWidth: "none", marginBottom: "0.8rem" }}
          placeholder="OmniVoice Modal URL (needed for OmniVoice in the builder preview)"
          value={builderUrl}
          onChange={(e) => {
            setBuilderUrl(e.target.value);
            lsPut(BUILDER_TTS_URL_KEY, e.target.value);
          }}
        />
      )}

      <div className="bl-quiz-q">
        <div className="q">🎙 Book voice {voice ? "· created" : ""}</div>
        {voice ? (
          <>
            <p style={{ margin: "0 0 0.5rem", fontSize: "0.8rem", color: "var(--bl-muted)" }}>
              Seed: “{voice.refText.slice(0, 80)}{voice.refText.length > 80 ? "…" : ""}”
            </p>
            {previewUrl && <audio controls src={previewUrl} style={{ width: "100%", marginBottom: "0.4rem" }} />}
            <button className="bl-btn" onClick={removeVoice}>Remove voice</button>
          </>
        ) : (
          <>
            <p style={{ margin: "0 0 0.5rem", fontSize: "0.8rem", color: "var(--bl-muted)" }}>
              Seed sentence: “{seedText.slice(0, 90)}{seedText.length > 90 ? "…" : ""}”
            </p>
            <button className="bl-btn primary" onClick={createVoice} disabled={seedBusy}>
              {seedBusy ? <><Spinner size={12} /> Creating</> : "🎙 Create book voice"}
            </button>
          </>
        )}
      </div>

      <div className="bl-quiz-q">
        <div className="q">🎧 Audiobook ({paragraphs.length} paragraphs)</div>
        <p style={{ margin: "0 0 0.6rem", fontSize: "0.78rem", color: "var(--bl-muted)" }}>
          Generates every paragraph in the book voice. The first call warms your Modal GPU (can take a couple
          of minutes); cached paragraphs are skipped, so a stopped run resumes where it left off.
        </p>
        {gen.running ? (
          <>
            <div style={{ background: "color-mix(in srgb, var(--bl-border) 60%, transparent)", borderRadius: 99, height: 10, overflow: "hidden", marginBottom: "0.5rem" }}>
              <div style={{ width: `${(gen.done / Math.max(1, gen.total)) * 100}%`, height: "100%", background: "var(--bl-accent)", borderRadius: 99, transition: "width 0.3s" }} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", fontSize: "0.78rem", color: "var(--bl-muted)" }}>
              <Spinner size={12} /> {gen.done} / {gen.total} done {gen.current && <>· <span className="bl-cite">{gen.current}</span></>}
              <button className="bl-btn" style={{ marginLeft: "auto" }} onClick={() => { cancelRef.current = true; }}>Stop</button>
            </div>
          </>
        ) : gen.done > 0 ? (
          <p style={{ margin: "0 0 0.5rem", fontSize: "0.8rem" }}>{gen.done} / {gen.total} paragraphs cached in the book voice.</p>
        ) : null}
        {!gen.running && (
          <button className="bl-btn primary" onClick={generateAudiobook} disabled={!voice}>
            ▶ {gen.done > 0 ? "Resume audiobook" : "Generate audiobook"}
          </button>
        )}
      </div>

      {message && <div className="bl-msg" style={{ marginTop: "0.8rem" }}>{message}</div>}
    </div>
  );
}
