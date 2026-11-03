"""
Test client for the OmniVoice TTS Modal endpoints (text -> WAV).

Steps:
  1) Deploy the TTS app:
         modal deploy modal-ocr-tts/omnivoice_tts_modal.py
  2) Copy the URLs printed by `modal deploy` into the constants below:
       GET  endpoint -> ...--omnivoice-tts-omnivoicetts-tts.modal.run
       POST endpoint -> ...--omnivoice-tts-omnivoicetts-clone.modal.run
  3) Set TEXT (and optionally REF_AUDIO_PATH for voice cloning).
  4) Run:
         python test_tts.py                  # runs all 3 modes by default
         python test_tts.py --mode design     # or: auto | design | clone

Only dependency:  pip install requests

NOTE: the first request after idle pays the cold start (~30-60 s).
"""

import argparse
import base64
import pathlib
import sys
import time

import requests

# ======================= UPDATE THESE ========================================
GET_URL = "https://workspace--omnivoice-tts-omnivoicetts-tts.us-east.modal.run"
CLONE_URL = "https://workspace--omnivoice-tts-omnivoicetts-clone.us-east.modal.run"

TEXT = "Hello! This is a test of OmniVoice running serverless on Modal. [laughter] It works!"
INSTRUCT = "female, low pitch, british accent"   # voice-design description
REF_AUDIO_PATH = "/tmp/tts-test-auto.wav"  # the wav produced by --mode auto; set to
                                           # your own 3-10 s clip for real cloning tests
REF_TEXT = ""         # optional transcript of REF_AUDIO_PATH ("" = auto-transcribed)
NUM_STEP = 32        # diffusion steps (16 = faster, 32 = default quality)

OUTPUT_DIR = "/tmp"   # outputs: tts-test-auto.wav, tts-test-design.wav, tts-test-clone.wav
# =============================================================================

TIMEOUT_SECONDS = 600  # 10 min: covers cold start + long texts


def _save_wav(data: bytes, name: str) -> pathlib.Path:
    out = pathlib.Path(OUTPUT_DIR) / name
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(data)
    return out


def _check(resp: requests.Response, label: str, elapsed: float) -> bytes:
    if resp.status_code != 200:
        print(f"[FAILED] {label}: HTTP {resp.status_code} after {elapsed:.1f}s")
        print(f"Response body:\n{resp.text[:2000]}")
        sys.exit(1)
    print(f"[OK] {label}: HTTP 200 in {elapsed:.1f}s, {len(resp.content)} bytes of audio")
    return resp.content


def mode_auto() -> pathlib.Path:
    """Simplest call: GET ?text=... -> WAV in an automatically chosen voice."""
    print(f"\n=== mode: AUTO (GET, random voice) -> {GET_URL}")
    t0 = time.time()
    resp = requests.get(GET_URL, params={"text": TEXT}, timeout=TIMEOUT_SECONDS)
    return _save_wav(_check(resp, "auto", time.time() - t0), "tts-test-auto.wav")


def mode_design() -> pathlib.Path:
    """Voice design: POST JSON with an `instruct` description, no reference clip."""
    print(f'\n=== mode: DESIGN (instruct="{INSTRUCT}") -> {CLONE_URL}')
    t0 = time.time()
    resp = requests.post(
        CLONE_URL,
        json={"text": TEXT, "instruct": INSTRUCT, "num_step": NUM_STEP},
        timeout=TIMEOUT_SECONDS,
    )
    return _save_wav(_check(resp, "design", time.time() - t0), "tts-test-design.wav")


def mode_clone() -> pathlib.Path:
    """Voice cloning: POST JSON with a base64 reference clip."""
    ref = pathlib.Path(REF_AUDIO_PATH)
    if not REF_AUDIO_PATH or not ref.exists():
        print("\n=== mode: CLONE skipped (set REF_AUDIO_PATH at the top of this file)")
        sys.exit(0)
    print(f"\n=== mode: CLONE (ref={ref.name}, {ref.stat().st_size / 1e6:.2f} MB) -> {CLONE_URL}")
    payload = {
        "text": TEXT,
        "ref_audio_b64": base64.b64encode(ref.read_bytes()).decode(),
        "num_step": NUM_STEP,
    }
    if REF_TEXT:
        payload["ref_text"] = REF_TEXT
    t0 = time.time()
    resp = requests.post(CLONE_URL, json=payload, timeout=TIMEOUT_SECONDS)
    return _save_wav(_check(resp, "clone", time.time() - t0), "tts-test-clone.wav")


def main():
    parser = argparse.ArgumentParser(description="Test the OmniVoice TTS endpoints")
    parser.add_argument("--mode", choices=["auto", "design", "clone", "all"], default="all")
    parser.add_argument("--text", default=TEXT)
    parser.add_argument("--instruct", default=INSTRUCT)
    args = parser.parse_args()

    globals()["TEXT"] = args.text
    globals()["INSTRUCT"] = args.instruct

    outputs = []
    if args.mode in ("auto", "all"):
        outputs.append(mode_auto())
    if args.mode in ("design", "all"):
        outputs.append(mode_design())
    if args.mode in ("clone", "all"):
        outputs.append(mode_clone())

    print("\nSaved audio files:")
    for p in outputs:
        print(f"  {p}  ({p.stat().st_size / 1024:.0f} KB)")
    print("\nPlay them with:  afplay <file>   (macOS)  |  aplay <file>  (Linux)")


if __name__ == "__main__":
    main()
