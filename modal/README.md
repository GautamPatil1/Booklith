# Serverless OCR + TTS on Modal.com (pay-per-use)

OCR + TTS as independent deployments — deploy either or both; both scale to zero,
so **you pay only per second of actual GPU usage** (Modal has no idle charges).

Both OCR files serve the SAME model — Baidu **Unlimited-OCR-2** (pick ONE):

| File | Model | Engine | What you get |
|---|---|---|---|
| `ocr2_modal.py` | `baidu/Unlimited-OCR-2` (MIT) | native Transformers (`trust_remote_code`) — **simple default** | POST PDF/image → Markdown |
| `ocr2_sglang_modal.py` | `baidu/Unlimited-OCR-2` (MIT) | **SGLang** (upstream-recommended serving, Baidu's patched wheel) | POST PDF → Markdown **+** raw OpenAI-style `/v1/chat/completions` endpoint |
| `omnivoice_tts_modal.py` | `k2-fsa/OmniVoice` (weights **CC-BY-NC**) | plain PyTorch (`pip install omnivoice`) | POST/GET text → 24 kHz WAV (clone / design / auto voice) |

## Research findings (2026-11-02)

### Baidu OCR ("OCR 2")
- The model you called "OCR 2 by Baidu" is **`baidu/Unlimited-OCR-2`**
  ("Unlimited OCR Works 2", released 2026-10-27, MIT, arXiv:2610.39308).
  There is no public `baidu/OCR-2` HF repo. Its predecessor is `baidu/Unlimited-OCR` (3B dense).
- **vLLM support: NO for OCR-2.** Only the older v1 `baidu/Unlimited-OCR` is in vLLM
  (`UnlimitedOCRForCausalLM`; recipe <https://recipes.vllm.ai/baidu/Unlimited-OCR>).
- OCR-2 upstream supports **SGLang** (recommended for serving; patched wheel
  `sglang-0.5.20.dev13+g75b9b06b02` from <https://github.com/baidu/Unlimited-OCR>)
  and native **Transformers** — this folder ships BOTH:
  - `ocr2_modal.py`: Transformers path — simplest, no custom wheels (default).
  - `ocr2_sglang_modal.py`: SGLang path — highest throughput + OpenAI-compatible
    API (the "vLLM-style" equivalent for OCR-2).
  PDFs are rasterized with PyMuPDF (300 dpi) and parsed in one request
  (cross-page context, `<PAGE>` separators in output).
- Quirks that matter (both versions): prompt must start with a literal `<image>`,
  `skip_special_tokens=False` is required, the no-repeat-n-gram logit processor
  (`ngram_size=35`, `window_size=128` single-page / `1024` multi-page) is mandatory,
  and raw output contains `<|ref|>…<|/ref|>` / `<|det|>…<|/det|>` grounding tokens
  (the code here strips them into clean Markdown).

### OmniVoice TTS
- **`k2-fsa/OmniVoice`** — omnilingual zero-shot TTS (600+ languages) from the
  Kaldi/icefall team (arXiv:2604.00688). **Not a vLLM model** — it's a PyTorch
  library (`pip install omnivoice`): `OmniVoice.from_pretrained(...)`,
  `model.generate(text=..., ref_audio=..., instruct=..., num_step=32, speed=, duration=)`
  → 24 kHz numpy audio. RTF ≈ 0.09 (H100, batch 1), ~0.025 with FlashInfer.
- Modes: **voice cloning** (3–10 s reference clip), **voice design**
  (`instruct="female, low pitch, british accent"`), **auto voice** (nothing passed).
- ⚠️ **License: model weights are CC-BY-NC (non-commercial)**; code is Apache-2.0.

### How vLLM works on Modal
Modal's official pattern (see their `vllm_inference.py` example): spawn a raw
`vllm serve` subprocess inside a `@app.server` class that exposes port 8000 to the
internet → you get the full **OpenAI-compatible API schema** (`/v1/chat/completions`,
`/v1/models`, `/health`) at a public URL. `scaledown_window` controls how long a
warm server stays up; leaving `min_containers` unset means **scale-to-zero**.
Modal also offers `@modal.fastapi_endpoint` web functions and a newer managed
"Endpoints" product (see <https://modal.com/docs/guide/endpoints>) if you'd rather
not maintain serving code.

## Deploy & call

```bash
pip install -U modal && modal setup        # one-time auth
# (a `venv/` with modal 1.6.3 + requests already exists in this folder)

modal deploy modal-ocr-tts/ocr2_modal.py            # OCR-2 via Transformers (simple)
modal deploy modal-ocr-tts/ocr2_sglang_modal.py      # OCR-2 via SGLang (+ OpenAI API)
modal deploy modal-ocr-tts/omnivoice_tts_modal.py
```

URLs are printed at deploy time — paste them into the test clients and run:

```bash
# edit the URL + PDF_PATH constants at the top of the file, then:
python test_ocr.py                       # POSTs your PDF, saves + previews the .md
python test_tts.py                       # tests all 3 TTS modes, saves .wav files
python test_tts.py --mode design         # or: auto | design | clone
```

Or call the deployed endpoints directly:

```bash
# OCR: PDF -> Markdown
curl -X POST "https://<ws>--baidu-ocr2-unlimitedocr2-parse-pdf.modal.run" \
     -F "pdf=@doc.pdf" -o doc.md

# SGLang deployment: use it like OpenAI from Python
from openai import OpenAI
client = OpenAI(base_url="<SGLANG-SERVER-URL>/v1", api_key="EMPTY")

# TTS: text -> WAV
curl --get "https://<ws>--omnivoice-tts-omnivoicetts-tts.modal.run" \
     --data-urlencode "text=Hello from Modal!" -o hello.wav
# TTS with voice design / cloning (JSON POST)
curl -X POST "https://<ws>--omnivoice-tts-omnivoicetts-clone.modal.run" \
     -H "Content-Type: application/json" \
     -d '{"text":"Hi!","instruct":"male, elderly, whisper"}' -o hi.wav
```

## Pay-per-use notes ("I only pay for what I use")

- Modal bills **per second** of container runtime; all three apps use
  `scaledown_window=60s` (Modal's minimum) → containers stop 60s after the last
  request and idle cost is exactly $0. Trade-off: any idle gap > 1 min means the
  next request pays the cold start again (~80-130s OCR / ~60-115s TTS, weights
  cached on the `huggingface-cache` volume). If you'd rather trade money for
  latency, raise `scaledown_window` or set `min_containers=1` (always warm).
- Approx. GPU prices (per hour, check <https://modal.com/pricing>): L4 $0.80,
  A10G $1.10, L40S $1.42, A100-40GB $1.86, A100-80GB $2.15, H100 $3.95, H200 $4.54.
  So OCR-2 on A100 ≈ $0.0005/sec of use; TTS on L4 ≈ $0.0002/sec.
- **Cold starts**: first request after idle pays container boot + model load.
  Model weights are cached on a shared `modal.Volume` (`huggingface-cache`) so
  they download only once ever. Expect ~1–3 min cold start for the OCR models,
  ~30–60 s for OmniVoice. To keep warm, add `min_containers=1` (then you *do*
  pay for the idle GPU). Modal "memory snapshots" can cut cold starts further:
  <https://modal.com/docs/guide/memory-snapshots>
- The web endpoints in these files are **public** (unguessable URLs). For
  production add `requires_proxy_auth=True` to `@modal.fastapi_endpoint` and
  `unauthenticated=False` on the server, then send `Modal-Key`/`Modal-Secret`
  headers (<https://modal.com/docs/guide/webhook-proxy-auth>).

## Ready-made templates this is based on

- Modal official serving examples: `modal-labs/modal-examples` →
  `06_gpu_and_ml/llm-serving/` (`vllm_inference.py`, `sglang_vlm.py`, SGLang
  examples, `openai_compatible/` clients + locust load tests) — the pattern
  `ocr2_sglang_modal.py` follows
- Modal official TTS example: `06_gpu_and_ml/text-to-audio/chatterbox_tts.py`
  (the `omnivoice_tts_modal.py` layout mirrors it)
- Baidu Unlimited-OCR: <https://github.com/baidu/Unlimited-OCR> ·
  <https://huggingface.co/baidu/Unlimited-OCR-2>
- OmniVoice: <https://github.com/k2-fsa/OmniVoice> ·
  <https://huggingface.co/k2-fsa/OmniVoice>
- vLLM recipe for Unlimited-OCR: <https://recipes.vllm.ai/baidu/Unlimited-OCR>

## Limitations / assumptions

- `ocr2_modal.py` uses upstream's Transformers code via `trust_remote_code=True`
  (review remote code before running, as with any such model). Deps pinned to
  Baidu's tested versions.
- `ocr2_sglang_modal.py` installs Baidu's patched SGLang dev wheel
  (`sglang-0.5.20.dev13+g75b9b06b02`, pulled from the repo's git-lfs) — all env
  vars and launch flags are copied verbatim from the OCR-2 model card.
- Web request bodies should stay ≲ 100 MB; for larger PDFs put them on a
  `modal.Volume` or S3 and pass a path.
- OmniVoice weights are **CC-BY-NC** — non-commercial use only.
- OmniVoice `ref_audio` uploads are base64 JSON; the GET endpoint is text-only.

## Deployment gotchas learned the hard way (verified 2026-11-02)

- **Modal change detection misses module-level helper edits.** Editing a plain
  helper function (like `postprocess()`) triggers `modal deploy` →
  *"Deployment skipped: no changes detected!"* and your change never goes live.
  Fix: bump the `_version` constant inside `parse_pdf_bytes` (and the
  `X-Code-Version` header) whenever you edit anything, and verify the header:
  `curl -D - -F "pdf=@tiny.pdf" <parse-pdf-url> | grep x-code-version`.
- **Warm containers keep serving OLD code** until they scale down, even after a
  deploy. To force fresh containers: `modal app stop baidu-ocr2-sglang -y`
  then `modal deploy ...`. (Trade-off: you pay a cold start.)
- The SGLang stack needs a **CUDA devel** image: Baidu's wheel pins
  torch==2.13.0 / flashinfer[cu13] / cuda-python≥13, and deep_gemm JIT-compiles
  kernels, so it crashes with `AssertionError` (no CUDA_HOME) on slim images.
  `nvidia/cuda:13.0.0-devel-ubuntu22.04` works on Modal (host driver 610.x).
- Wheel installs: pip validates wheel *filenames* (keep Baidu's canonical
  name) and needs pip ≥ 25 for the wheel's `Metadata-Version: 2.4`.
- An occasional HTTP 303 from `*.modal.run` is Modal's proxy retry-redirect —
  `requests` follows it automatically; plain `curl` needs `--location` or a retry.
- Measured on your workspace (gautampatilwrites / us-east): 60-page Marathi
  PDF → 121.5 s warm, 82-128 s cold (weights cached on the volume), ~500
  tok/s decode, clean Markdown with `<!-- page break -->` page separators.
  OmniVoice: auto 115 s cold / design 5.3 s / clone 23.2 s (incl. Whisper
  transcription of the reference clip).
