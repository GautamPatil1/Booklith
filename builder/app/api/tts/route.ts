import { NextResponse } from "next/server";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";

export const runtime = "nodejs";
export const maxDuration = 300;

interface Body {
  text: string;
  lang?: string;
  engine?: "auto" | "edge" | "omnivoice";
  /** the user's OmniVoice Modal URL, supplied per request from their browser
   * (Booklith hosts no secrets; this is the BUILDER, not the exported reader) */
  ttsUrl?: string;
  /** optional voice-clone reference for OmniVoice */
  refAudioB64?: string;
  refText?: string;
}

/**
 * Builder-preview TTS: used by the Audio tab while previewing a book, so the
 * audiobook flow can be tested BEFORE export. The exported reader uses its own
 * server-side env/committed config instead.
 */
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

  // 1. OmniVoice with the user's endpoint (optional; supports voice clone)
  const ttsUrl = typeof body.ttsUrl === "string" ? body.ttsUrl.trim() : "";
  if (engine === "omnivoice" && !ttsUrl) {
    return NextResponse.json({ error: "OmniVoice requires the Modal TTS URL in the builder preview." }, { status: 503 });
  }
  if (engine !== "edge" && ttsUrl) {
    // Modal's proxy occasionally answers 303 (fetch follows as GET -> 400
    // "bad redirect method"); retry up to 3 times like the browser does.
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const payload: Record<string, unknown> = { text, num_step: 32 };
        if (body.refAudioB64) {
          payload.ref_audio_b64 = body.refAudioB64;
          if (body.refText) payload.ref_text = body.refText;
        }
        const res = await fetch(ttsUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          const wav = await res.arrayBuffer();
          if (wav.byteLength > 100) {
            return new NextResponse(wav, { headers: { "Content-Type": "audio/wav", "X-TTS-Engine": "omnivoice" } });
          }
        }
        const errText = await res.text().catch(() => "");
        if (!(res.status >= 500 || (res.status === 400 && /bad redirect/i.test(errText)))) break;
      } catch {
        /* retry */
      }
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
    if (engine === "omnivoice") {
      return NextResponse.json({ error: "OmniVoice synthesis failed." }, { status: 502 });
    }
  }

  // 2. Edge Read-Aloud voices (keyless)
  if (engine !== "omnivoice") {
    let edgeError = "Edge TTS returned no audio.";
    try {
      const VOICES: Record<string, string> = {
        en: "en-US-AriaNeural", hi: "hi-IN-SwaraNeural", mr: "mr-IN-AarohiNeural",
        zh: "zh-CN-XiaoxiaoNeural", ja: "ja-JP-NanamiNeural", ko: "ko-KR-SunHiNeural",
        es: "es-ES-ElviraNeural", fr: "fr-FR-DeniseNeural", de: "de-DE-KatjaNeural",
      };
      const voice = VOICES[(body.lang ?? "en").split("-")[0]] ?? "en-US-AriaNeural";
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
      if (total.length > 200) {
        return new NextResponse(new Uint8Array(total), { headers: { "Content-Type": "audio/mpeg", "X-TTS-Engine": "edge" } });
      }
      edgeError = `Edge TTS returned only ${total.length} audio bytes.`;
    } catch (error) {
      edgeError = error instanceof Error ? error.message : String(error);
      console.warn("Edge TTS synthesis failed; using fallback if enabled:", edgeError);
    }
    if (engine === "edge") {
      return NextResponse.json({ error: `Edge TTS synthesis failed: ${edgeError}` }, { status: 502 });
    }
  }

  // 3. Client-side fallback
  return NextResponse.json({ fallback: "client" });
}
