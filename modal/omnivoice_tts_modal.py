"""
k2-fsa OmniVoice (`k2-fsa/OmniVoice`) as a serverless HTTP TTS API on Modal.
POST text (+ optional reference audio or voice-design instructions) -> WAV audio.

Research notes (verified 2026-11-02):
  * OmniVoice = massively multilingual zero-shot TTS (600+ languages) from the
    k2-fsa team (Kaldi/icefall lineage, Daniel Povey et al., arXiv:2604.00688).
    Features: voice cloning from a short reference clip, voice design via
    speaker attributes, non-verbal tags like [laughter], ~40x real-time.
  * It is NOT a vLLM/LLM-stack model: it ships as a plain PyTorch library
    (`pip install omnivoice`) with `OmniVoice.from_pretrained(...)` /
    `model.generate(...)`. Output is 24 kHz float numpy arrays.
  * LICENSE CAVEAT: code is Apache-2.0 but the model WEIGHTS are CC-BY-NC
    (non-commercial) -- do not use this in a commercial product.
  * Upstream: https://github.com/k2-fsa/OmniVoice

Usage:
    modal deploy modal-ocr-tts/omnivoice_tts_modal.py
    modal run modal-ocr-tts/omnivoice_tts_modal.py --text "Hello from Modal!"

HTTP API (URLs printed at deploy time):
  # simple: pick any voice (auto), just text
  curl --get "https://<workspace>--omnivoice-tts-omnivoicetts-tts.modal.run" \
       --data-urlencode "text=Hello from Modal!" -o hello.wav
  # full JSON API: voice cloning / voice design / speed / duration
  curl -X POST "https://<workspace>--omnivoice-tts-omnivoicetts-clone.modal.run" \
       -H "Content-Type: application/json" \
       -d '{"text": "Hello!", "instruct": "female, low pitch, british accent"}' \
       -o hello.wav
"""

import modal

MINUTES = 60
MODEL_ID = "k2-fsa/OmniVoice"

image = (
    modal.Image.debian_slim(python_version="3.12")
    .uv_pip_install(
        "torch==2.8.0",
        "torchaudio==2.8.0",
        "omnivoice",
        "fastapi[standard]==0.124.4",
        "soundfile",
        "numpy",
        # optional extra for automatic number normalization:
        # "omnivoice[tn]",
    )
)

hf_cache_vol = modal.Volume.from_name("huggingface-cache", create_if_missing=True)

app = modal.App("omnivoice-tts", image=image)


@app.cls(
    gpu="l4",  # small model (Qwen3-0.6B-based): an L4 is plenty; a10g/h100 = faster
    scaledown_window=1 * MINUTES,  # minimum: stop billing 60s after the last request
    timeout=10 * MINUTES,
    volumes={"/root/.cache/huggingface": hf_cache_vol},
    # secrets=[modal.Secret.from_name("huggingface")],  # optional HF token
)
@modal.concurrent(max_inputs=4)
class OmniVoiceTTS:
    @modal.enter()
    def load(self):
        import torch

        from omnivoice import OmniVoice

        self.model = OmniVoice.from_pretrained(
            MODEL_ID,
            device_map="cuda:0",
            dtype=torch.float16,
        )

    def _generate(self, request: dict) -> bytes:
        import base64
        import io
        import os
        import tempfile

        import numpy as np
        import soundfile as sf

        kwargs = {
            "text": request["text"],
            "num_step": int(request.get("num_step") or 32),  # 16 = faster
        }
        for optional in ("ref_text", "instruct", "language_id", "speed", "duration"):
            if request.get(optional) is not None:
                kwargs[optional] = request[optional]
        if request.get("normalize_text"):
            kwargs["normalize_text"] = True

        # voice cloning: reference clip is passed as base64 WAV/MP3/etc.
        if request.get("ref_audio_b64"):
            data = base64.b64decode(request["ref_audio_b64"])
            suffix = ".mp3" if data[:3] == b"ID3" or data[:2] == b"\xff\xfb" else ".wav"
            ref_path = os.path.join(tempfile.mkdtemp(), "ref" + suffix)
            with open(ref_path, "wb") as f:
                f.write(data)
            kwargs["ref_audio"] = ref_path  # a 3-10 s clip works best

        audio = self.model.generate(**kwargs)  # list[np.ndarray] @ 24 kHz
        wav = np.concatenate(audio) if len(audio) > 1 else audio[0]

        buf = io.BytesIO()
        sf.write(buf, wav, 24000, format="WAV")
        return buf.getvalue()

    # ---- HTTP endpoints ------------------------------------------------------
    @modal.fastapi_endpoint(method="POST", docs=True)
    def clone(self, request: dict):
        """POST a JSON body -> WAV bytes.

        Body fields:
          text (required)          : text to speak
          ref_audio_b64 (optional) : base64 of a 3-10 s reference clip -> voice cloning
          ref_text (optional)      : transcript of the reference clip
                                     (omitted = auto-transcribed with Whisper)
          instruct (optional)      : voice design, e.g. "female, low pitch,
                                     british accent" (no reference clip needed)
          num_step (optional)      : diffusion steps, default 32 (16 = faster)
          speed / duration / language_id / normalize_text (optional)
        """
        from fastapi import Response

        if not request.get("text"):
            return Response(content='{"error": "text is required"}', status_code=400)
        audio = self._generate(request)
        return Response(content=audio, media_type="audio/wav")

    @modal.fastapi_endpoint(method="GET", docs=True)
    def tts(self, text: str, instruct: str | None = None):
        """GET ?text=...[&instruct=...] -> WAV bytes (quick tests / browser)."""
        from fastapi import Response

        audio = self._generate({"text": text, "instruct": instruct})
        return Response(content=audio, media_type="audio/wav")

    @modal.method()
    def generate_to_bytes(self, request: dict) -> bytes:
        return self._generate(request)


@app.local_entrypoint()
def main(
    text: str = "Hello! This is OmniVoice running serverless on Modal.",
    output_path: str = "/tmp/omnivoice.wav",
):
    import pathlib

    tts = OmniVoiceTTS()
    audio = tts.generate_to_bytes.remote({"text": text})
    pathlib.Path(output_path).write_bytes(audio)
    print(f"Audio saved to {output_path}")
