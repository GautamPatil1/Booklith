import { NextResponse } from "next/server";
import { llmEnv } from "../../../lib/serverLlm";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Voice input for the AI chat sidebar — transcribes the reader's speech with
 * Meta Muse Voice Transcribe (muse-voice-transcribe-1.0) on the Meta Model
 * API. The key stays server-side; the browser sends a WAV recorded via
 * MediaRecorder + client-side WAV encoding (see lib/wav.ts).
 *
 * Meta API contract (verified): POST /v1/asr/transcribe,
 * multipart/form-data with `request` (JSON settings) + `audio` (WAV, ≤32 MB,
 * ≤10 min) -> buffered JSON { sessionId, transcript, turns, ... }.
 */
export async function POST(req: Request) {
  const env = llmEnv();
  if (!env || !env.isMeta) {
    return NextResponse.json(
      { error: "Voice input needs API_KEY and API_BASE_URL=https://api.meta.ai/v1." },
      { status: 500 },
    );
  }

  const form = await req.formData().catch(() => null);
  const audio = form?.get("audio");
  if (!(audio instanceof File)) {
    return NextResponse.json({ error: "multipart field `audio` (WAV) is required." }, { status: 400 });
  }

  const metaForm = new FormData();
  metaForm.append(
    "request",
    new Blob(
      [JSON.stringify({ model: "muse-voice-transcribe-1.0", audioEncoding: "WAV", mode: "PUSH_TO_TALK" })],
      { type: "application/json" },
    ),
  );
  metaForm.append("audio", audio, "recording.wav");

  const res = await fetch("https://api.meta.ai/v1/asr/transcribe", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.apiKey}`, Accept: "application/json" },
    body: metaForm,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return NextResponse.json({ error: `Transcription failed (HTTP ${res.status}): ${body.slice(0, 200)}` }, { status: 502 });
  }
  const data = (await res.json()) as { transcript?: string };
  return NextResponse.json({ transcript: (data.transcript ?? "").trim() });
}
