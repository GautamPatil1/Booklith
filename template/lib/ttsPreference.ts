"use client";

import { lsGet, lsPut } from "./cache";

export type TtsEngine = "auto" | "edge" | "omnivoice";

const TTS_ENGINE_KEY = "tts-engine";

export function getTtsEngine(): TtsEngine {
  const engine = lsGet<string>(TTS_ENGINE_KEY);
  return engine === "edge" || engine === "omnivoice" || engine === "auto" ? engine : "edge";
}

export function setTtsEngine(engine: TtsEngine): void {
  lsPut(TTS_ENGINE_KEY, engine);
}
