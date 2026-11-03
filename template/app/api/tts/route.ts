import { NextResponse } from "next/server";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import ttsUrlConfig from "../../../content/tts-url.json";

export const runtime = "nodejs";
export const maxDuration = 300; // OmniVoice cold start can take minutes

interface Body {
  text: string;
  lang?: string; // BCP-47-ish hint for voice selection
  engine?: "auto" | "edge" | "omnivoice";
  /** VOICE CLONE reference: base64 WAV (3–10 s) of the seed clip (OmniVoice). */
  refAudioB64?: string;
  /** exact transcript of refAudioB64 — lets the service skip Whisper. */
  refText?: string;
}

/**
 * TTS proxy with a layered fallback chain:
 *   1. OmniVoice on Modal (best quality, 600+ languages) — URL from env
 *      MODAL_TTS_URL, or the committed default written by the Builder export
 *      (content/tts-url.json) if the user filled the optional field.
 *   2. Microsoft Edge Read-Aloud voices (msedge-tts, keyless).
 *   3. If both fail: respond { fallback: "client" } and the BROWSER plays the
 *      keyless online fallback voice instead (see lib/fallbackTts.ts).
 * The browser never sees any secret — everything happens server-side.
 */

// a sensible Edge neural voice per language hint
const EDGE_VOICES: Record<string, string> = {
  en: "en-US-AriaNeural", hi: "hi-IN-SwaraNeural", mr: "mr-IN-AarohiNeural",
  bn: "bn-IN-TanishaaNeural", ta: "ta-IN-PallaviNeural", te: "te-IN-ShrutiNeural",
  kn: "kn-IN-SapnaNeural", ml: "ml-IN-SobhanaNeural", gu: "gu-IN-DhwaniNeural",
  pa: "pa-IN-VaaniNeural", ur: "ur-PK-AsadNeural", sa: "hi-IN-SwaraNeural",
  zh: "zh-CN-XiaoxiaoNeural", ja: "ja-JP-NanamiNeural", ko: "ko-KR-SunHiNeural",
  es: "es-ES-ElviraNeural", fr: "fr-FR-DeniseNeural", de: "de-DE-KatjaNeural",
  it: "it-IT-ElsaNeural", pt: "pt-BR-FranciscaNeural", ru: "ru-RU-SvetlanaNeural",
  ar: "ar-EG-SalmaNeural", fa: "fa-IR-DilaraNeural", he: "he-IL-HilaNeural",
  tr: "tr-TR-EmelNeural", nl: "nl-NL-ColetteNeural", pl: "pl-PL-ZofiaNeural",
  id: "id-ID-GadisNeural", vi: "vi-VN-HoaiMyNeural", th: "th-TH-PremwadeeNeural",
  sw: "sw-KE-RafikiNeural",
};

async function resolveTtsUrl(): Promise<string | null> {
  if (process.env.MODAL_TTS_URL) return process.env.MODAL_TTS_URL;
  const url = (ttsUrlConfig as { url?: string | null }).url;
  return url?.trim() || null;
}

async function omnivoice(url: string, text: string, body?: Body): Promise<ArrayBuffer | null> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.MODAL_TTS_HEADERS) {
    try {
      Object.assign(headers, JSON.parse(process.env.MODAL_TTS_HEADERS) as Record<string, string>);
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : String(error));
    }
  }
  // Modal's proxy occasionally answers 303 with a retry token, which fetch
  // follows as GET -> "bad redirect method" (see modal/README.md). Retry.
  for (let attempt = 1; attempt <= 3; attempt++) {
    const payload: Record<string, unknown> = { text, num_step: 32 };
    if (body?.refAudioB64) {
      payload.ref_audio_b64 = body.refAudioB64; // voice cloning reference
      if (body.refText) payload.ref_text = body.refText; // known transcript — skips Whisper
    }
    const instruct = process.env.MODAL_TTS_INSTRUCT;
    if (instruct) payload.instruct = instruct;
    try {
      const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
      if (res.ok) {
        const buf = await res.arrayBuffer();
        if (buf.byteLength > 100) return buf;
      }
      const errText = await res.text().catch(() => "");
      if (!(res.status >= 500 || (res.status === 400 && /bad redirect/i.test(errText)))) return null;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
  return null;
}

async function edgeTts(text: string, lang?: string): Promise<Buffer | null> {
  try {
    const base = (lang ?? "en").split("-")[0];
    const voice = EDGE_VOICES[base] ?? "en-US-AriaNeural";
    const tts = new MsEdgeTTS({ connectionTimeoutMs: 10000, synthesisTimeoutMs: 20000 });
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(text);
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      audioStream.on("data", (d: Buffer) => chunks.push(d));
      audioStream.on("close", () => resolve());
      audioStream.on("error", reject);
    });
    const total = Buffer.concat(chunks);
    return total.length > 200 ? total : null;
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
  }
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const text = (body.text || "").trim();
  if (!text) return NextResponse.json({ error: "text is required." }, { status: 400 });
  const engine = body.engine ?? "edge";
  if (engine !== "auto" && engine !== "edge" && engine !== "omnivoice") {
    return NextResponse.json({ error: "engine must be auto, edge, or omnivoice." }, { status: 400 });
  }

  // 1. OmniVoice on Modal
  const modalUrl = engine === "edge" ? null : await resolveTtsUrl();
  if (engine === "omnivoice" && !modalUrl) {
    return NextResponse.json({ error: "OmniVoice is not configured. Set MODAL_TTS_URL or content/tts-url.json." }, { status: 503 });
  }
  if (modalUrl) {
    try {
      const wav = await omnivoice(modalUrl, text, body);
      if (wav) {
        return new NextResponse(wav, { headers: { "Content-Type": "audio/wav", "X-TTS-Engine": "omnivoice" } });
      }
    } catch {
      if (engine === "omnivoice") {
        return NextResponse.json({ error: "OmniVoice synthesis failed." }, { status: 502 });
      }
    }
    if (engine === "omnivoice") {
      return NextResponse.json({ error: "OmniVoice synthesis failed." }, { status: 502 });
    }
  }

  // 2. Edge Read-Aloud voices (keyless)
  if (engine !== "omnivoice") {
    try {
      const mp3 = await edgeTts(text, body.lang);
      if (mp3) {
        return new NextResponse(new Uint8Array(mp3), { headers: { "Content-Type": "audio/mpeg", "X-TTS-Engine": "edge" } });
      }
      if (engine === "edge") {
        return NextResponse.json({ error: "Edge TTS returned no audio." }, { status: 502 });
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.warn("Edge TTS synthesis failed; using fallback if enabled:", detail);
      if (engine === "edge") {
        return NextResponse.json({ error: `Edge TTS synthesis failed: ${detail}` }, { status: 502 });
      }
    }
  }

  // 3. Signal the browser to use its keyless client-side fallback voice
  return NextResponse.json({ fallback: "client" });
}
