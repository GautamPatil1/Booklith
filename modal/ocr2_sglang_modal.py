"""
Baidu `baidu/Unlimited-OCR-2` served with SGLang on Modal — the upstream-
RECOMMENDED serving stack for OCR-2 (vLLM does not support OCR-2).

What you get:
  1) a public, OpenAI-compatible SGLang server (/v1/chat/completions) — use it
     from any OpenAI SDK client, and
  2) a convenience "POST a PDF, get Markdown back" endpoint on top of it.

Research notes (verified 2026-11-02):
  * OCR-2 upstream (https://github.com/baidu/Unlimited-OCR,
    https://huggingface.co/baidu/Unlimited-OCR-2) supports Transformers (quick
    tests) and SGLang (recommended for serving). SGLang needs Baidu's patched
    wheel `sglang-0.5.20.dev13+g75b9b06b02`, stored in the repo as git-lfs:
    https://media.githubusercontent.com/media/baidu/Unlimited-OCR/main/wheel/sglang-0.5.20.dev13%2Bg75b9b06b02-py3-none-any.whl
  * All server env vars / launch flags below are copied verbatim from the
    "Inference > SGLang" section of the OCR-2 model card.
  * Request schema specifics (per the model card's client):
      - images first, then text: "<PAGE><image>" * num_pages + "Multi page parsing."
      - skip_special_tokens=False, temperature=0
      - "custom_logit_processor": DeepseekOCRNoRepeatNGramLogitProcessor.to_str()
      - "custom_params": ngram_size=35, window_size=128 (single) / 1024 (multi),
        page_token_id=128827, eos_token_id=1, max_page_tokens=20000
      - "images_config": {"crop_mode": true=gundam(tiles) | false=base}
      - max_tokens must be positive: it's the global output budget (per-page x pages)

Usage:
    modal deploy modal-ocr-tts/ocr2_sglang_modal.py
    modal run modal-ocr-tts/ocr2_sglang_modal.py --pdf-path /path/to/doc.pdf

After deploy, TWO URLs are printed:
  1) the raw SGLang OpenAI-compatible server:
       from openai import OpenAI
       client = OpenAI(base_url="<SGLANG-SERVER-URL>/v1", api_key="EMPTY")
  2) the PDF -> Markdown endpoint:
       curl -X POST "<PDF-API-URL>" -F "pdf=@doc.pdf" -o doc.md
"""

import json

import fastapi
import modal

MINUTES = 60
SGLANG_PORT = 10000
MODEL_ID = "baidu/Unlimited-OCR-2"
SERVED_NAME = "Unlimited-OCR-2"
SGLANG_WHEEL_FILENAME = "sglang-0.5.20.dev13+g75b9b06b02-py3-none-any.whl"
SGLANG_WHEEL_URL = (
    "https://media.githubusercontent.com/media/baidu/Unlimited-OCR/main/"
    "wheel/sglang-0.5.20.dev13%2Bg75b9b06b02-py3-none-any.whl"  # %2B = escaped '+'
)

# OCR-2 model-card env vars (verbatim). The "EANABLE" typo is upstream's.
sglang_env = {
    "SGLANG_UOCR_EANABLE_DOC_LIMIT": "1",  # 1 = page-window scheduling
    "SGLANG_UOCR_DOC_GUNDAM_PAGE_WINDOW": "10",  # pages per window (gundam mode)
    "SGLANG_UOCR_DOC_BASE_PAGE_WINDOW": "10",  # pages per window (base mode)
    "SGLANG_UOCR_MAX_PAGE_TOKENS": "20000",  # per-page output cap
    "SGLANG_OPT_UOCR_SAM_REL_POS_BIAS_MB": "64",  # lower peak memory, same result
    "SGLANG_UOCR_SHM_WRAP_MODEL_DATA": "1",  # large crop tensors via /dev/shm
    "SGLANG_UOCR_SHM_WRAP_MIN_MB": "1",
    "SGLANG_VLM_CACHE_SIZE_MB": "0",
    "PYTORCH_CUDA_ALLOC_CONF": "expandable_segments:True",
    "HF_XET_HIGH_PERFORMANCE": "1",
}

# Baidu's patched SGLang wheel (downloaded from git-lfs) + model-card deps.
# Based on a CUDA *devel* image because:
#   * the wheel pins a CUDA 13 stack (torch==2.13.0, flashinfer_python[cu13],
#     cuda-python>=13.0), so we use nvidia/cuda:13.0.0-devel (CUDA 13 is
#     supported by Modal's host driver 610.x / CUDA Driver API 13.3)
#   * deep_gemm / flashinfer JIT-compile kernels and need CUDA_HOME/nvcc,
#     which slim images (pip-installed torch) do not provide -> the server
#     crashed with "AssertionError: cuda_home is not None" on debian_slim.
# NOTE: pip validates wheel FILENAMES, so the file must keep its canonical name
# (sglang-<version>-py3-none-any.whl) -- saving it as e.g. sglang-uocr.whl makes
# pip reject it with "Invalid wheel filename (wrong number of parts)".
sglang_image = (
    modal.Image.from_registry("nvidia/cuda:13.0.0-devel-ubuntu22.04", add_python="3.10")
    .entrypoint([])  # remove verbose logging by base image on entry
    .apt_install("curl")
    .run_commands(
        # download under the CANONICAL wheel filename, then sanity-check we got
        # the real ~15 MB wheel and not a 133-byte git-lfs pointer file
        f"curl -sL -o '/root/{SGLANG_WHEEL_FILENAME}' '{SGLANG_WHEEL_URL}'"
        f" && test $(stat -c%s '/root/{SGLANG_WHEEL_FILENAME}') -gt 1000000"
        f" && echo 'sglang wheel downloaded:' $(stat -c%s '/root/{SGLANG_WHEEL_FILENAME}') bytes"
    )
    .run_commands(
        # ensure pip is new enough for this wheel's Metadata-Version 2.4 (PEP 639);
        # then install Baidu's patched SGLang + the model-card deps
        "pip install --upgrade pip"
        f" && pip install '/root/{SGLANG_WHEEL_FILENAME}' pymupdf==1.27.2.2 fastokens==0.3.2"
    )
    .run_commands("pip install fastapi[standard]==0.124.4 requests")
    .env(sglang_env)
)

hf_cache_vol = modal.Volume.from_name("huggingface-cache", create_if_missing=True)

app = modal.App("baidu-ocr2-sglang", image=sglang_image)


@app.server(
    image=sglang_image,
    gpu="h100",  # upstream memory tuning assumes 80 GB GPUs
    scaledown_window=1 * MINUTES,  # minimum: stop billing 60s after the last request
    startup_timeout=20 * MINUTES,  # first start downloads the weights
    volumes={"/root/.cache/huggingface": hf_cache_vol},
    port=SGLANG_PORT,
    unauthenticated=True,  # public URL (README: how to secure with proxy auth)
    target_concurrency=8,
)
class Ocr2SglangServer:
    @modal.enter()
    def start(self):
        import subprocess

        # Flags below are verbatim from the OCR-2 model card (SGLang section).
        cmd = [
            "python", "-m", "sglang.launch_server",
            "--model-path", MODEL_ID,
            "--served-model-name", SERVED_NAME,
            "--chat-template", "unlimited-ocr",
            "--tokenizer-backend", "fastokens",
            "--tokenizer-worker-num", "8",
            "--mem-fraction-static", "0.7",
            "--max-running-requests", "64",
            "--max-prefill-tokens", "2048",
            "--enable-custom-logit-processor",
            "--enable-streaming-session",
            "--allow-auto-truncate",
            "--disable-radix-cache",
            "--mm-preprocess-cache-size-mb", "0",
            "--cuda-graph-backend-decode", "full",
            "--cuda-graph-max-bs-decode", "64",
            "--cuda-graph-backend-prefill", "full",
            "--cuda-graph-max-bs-prefill", "16384",
            "--cuda-graph-bs-prefill", "1024", "2048",
            "--cuda-graph-config",
            json.dumps({"prefill": {"backend": "full", "full_prefill_max_req": 64}}),
            "--host", "0.0.0.0",
            "--port", str(SGLANG_PORT),
        ]
        print(" ".join(cmd))
        self.process = subprocess.Popen(cmd)

    @modal.exit()
    def stop(self):
        self.process.terminate()


# ---- PDF -> Markdown convenience API (cheap CPU container, same image) --------
@app.cls(scaledown_window=1 * MINUTES, timeout=30 * MINUTES)
class Ocr2PdfApi:
    @modal.enter()
    def setup(self):
        # Required no-repeat-n-gram logit processor, serialized for the request.
        from sglang.srt.sampling.custom_logit_processor import (
            DeepseekOCRNoRepeatNGramLogitProcessor,
        )

        self.ngram_processor = DeepseekOCRNoRepeatNGramLogitProcessor.to_str()
        self.server_url: str | None = None

    def _url(self) -> str:
        if self.server_url is None:
            self.server_url = Ocr2SglangServer.get_url()
        return self.server_url

    def _wait_healthy(self, timeout: int = 15 * MINUTES):
        import time

        import requests

        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                if requests.get(f"{self._url()}/health", timeout=10).status_code == 200:
                    return
            except requests.RequestException:
                pass  # server cold-starting (first request pays the cold start)
            time.sleep(5)
        raise TimeoutError("SGLang OCR-2 server did not become healthy in time")

    @modal.method()
    def parse_pdf_bytes(self, pdf: bytes, dpi: int = 300, tokens_per_page: int = 8000) -> str:
        """PDF bytes -> Markdown. All pages go in ONE request (SR-SWA handles
        unbounded document lengths — no chunking needed)."""
        import base64

        _version = "v5"  # bump to force Modal change-detection to redeploy
        import fitz  # PyMuPDF
        import requests

        self._wait_healthy()

        pages = []
        with fitz.open(stream=pdf, filetype="pdf") as doc:
            mat = fitz.Matrix(dpi / 72, dpi / 72)
            for page in doc:
                pages.append(page.get_pixmap(matrix=mat).tobytes("png"))
        if not pages:
            raise ValueError("PDF contains no pages")

        # images FIRST, then the text prompt (per the model card's client)
        content = []
        for png in pages:
            b64 = base64.b64encode(png).decode()
            content.append(
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}}
            )
        content.append(
            {"type": "text", "text": "<PAGE><image>" * len(pages) + "Multi page parsing."}
        )

        payload = {
            "model": SERVED_NAME,
            "messages": [{"role": "user", "content": content}],
            "max_tokens": tokens_per_page * len(pages),  # global output budget
            "temperature": 0,
            "skip_special_tokens": False,
            "images_config": {"crop_mode": True},  # True = gundam (tiles)
            "custom_logit_processor": self.ngram_processor,
            "custom_params": {
                "ngram_size": 35,
                "window_size": 1024 if len(pages) > 1 else 128,
                "page_token_id": 128827,  # <PAGE> marker id
                "eos_token_id": 1,
                "max_page_tokens": 20000,  # per-page output cap
            },
            "stream": False,
        }
        resp = requests.post(
            f"{self._url()}/v1/chat/completions",
            json=payload,
            timeout=(30, 25 * MINUTES),
        )
        resp.raise_for_status()
        return postprocess(resp.json()["choices"][0]["message"]["content"])

    @modal.fastapi_endpoint(method="POST", docs=True)
    async def parse_pdf(
        self,
        pdf: fastapi.UploadFile = fastapi.File(...),
        dpi: int = fastapi.Form(300),
    ):
        """POST a PDF file (multipart field `pdf`) -> Markdown text."""
        md = self.parse_pdf_bytes.local(await pdf.read(), dpi)
        return fastapi.Response(
            content=md,
            media_type="text/markdown",
            headers={"X-Code-Version": "v5"},  # lets you verify which code is live
        )


def postprocess(raw: str) -> str:
    """OCR-2 raw output -> clean Markdown.

    Strips <|ref|>/<|/ref|> anchors, <|det|> grounding boxes, and the
    <BLOCK>type[coords]<FORK> block prefixes; <PAGE> -> page-break marker.
    """
    import re

    text = re.sub(r"<\|ref\|>(.*?)<\|/ref\|>", r"\1", raw, flags=re.DOTALL)
    det_re = re.compile(r"<\|det\|>([^<\s]+)(?:\s*\[[^\]]*\])?\s*<\|/det\|>(.*)")
    kept = []
    for line in text.splitlines():
        m = det_re.match(line.strip())
        if m:
            if m.group(1) == "image":  # image placeholders: drop entirely
                continue
            line = m.group(2)
        kept.append(line.rstrip())
    text = "\n".join(kept)
    # OCR-2 block format: <BLOCK>type(<LEVELn>)[coords]<FORK>content -> content
    text = re.sub(r"<BLOCK>[a-zA-Z0-9_]+(?:<LEVEL\d+>)?(?:\[[^\]]*\])*<FORK>", "", text)
    text = text.replace("<PAGE>", "\n\n<!-- page break -->\n\n")
    text = re.sub(r"\n{3,}", "\n\n", text)  # collapse extra blank lines
    # drop a leading page-break marker (string starts with newlines, so allow
    # leading whitespace before the anchored marker)
    text = re.sub(r"^\s*<!-- page break -->\s*", "", text)
    return text.strip()


@app.local_entrypoint()
def main(pdf_path: str, output_path: str = "/tmp/ocr2-sglang-output.md"):
    import pathlib

    api = Ocr2PdfApi()
    md = api.parse_pdf_bytes.remote(pathlib.Path(pdf_path).read_bytes())
    pathlib.Path(output_path).write_text(md)
    print(md[:2000])
    print(f"\n[full markdown saved to {output_path}]")
