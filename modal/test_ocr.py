"""
Test client for the Baidu Unlimited-OCR-2 Modal app (PDF -> Markdown).

The OCR app exposes TWO different endpoints (two separate containers):

  1) OCR_URL  -- `Ocr2PdfApi.parse_pdf`, a cheap CPU container. This is the one
     you normally use: POST a PDF file -> clean Markdown back. It rasterizes
     the PDF (PyMuPDF), builds the OCR-2 prompt, calls the GPU server below,
     and strips the raw <BLOCK>/<FORK>/<|det|> markers.

  2) SERVER_URL -- `Ocr2SglangServer`, the raw OpenAI-compatible SGLang server
     on the H100 GPU. It only accepts base64 page IMAGES in chat messages
     (cannot read PDFs) and returns the model's RAW output. Use it directly
     with the `openai` SDK (base_url=SERVER_URL + "/v1", api_key="EMPTY") for
     image-based OCR, custom prompts, or high-concurrency request fan-out.

Steps:
  1) Deploy the OCR app:
         modal deploy modal-ocr-tts/ocr2_modal.py
     (or  modal deploy modal-ocr-tts/ocr2_sglang_modal.py)
  2) Copy the `parse_pdf` URL printed by `modal deploy` into OCR_URL below.
       ocr2_modal.py       -> ...--baidu-ocr2-unlimitedocr2-parse-pdf.modal.run
       ocr2_sglang_modal.py -> ...--baidu-ocr2-sglang-ocr2pdfapi-parse-pdf.modal.run
  3) Set PDF_PATH to your document.
  4) Run:
         python test_ocr.py                   # PDF -> Markdown via OCR_URL
         python test_ocr.py --check-server    # also ping the raw GPU server
         python test_ocr.py --image page.png  # single image, raw server mode
     (CLI flags override the constants: --url ... --pdf ... --dpi ...)

Only dependency:  pip install requests

NOTE: the first request after idle pays the cold start (container boot +
model load, ~1-3 min). The client timeout below is set accordingly.
"""

import argparse
import base64
import pathlib
import sys
import time

import requests

# ======================= UPDATE THESE ========================================
# 1) PDF -> Markdown endpoint (CPU container) -- main entry point
OCR_URL = "https://gautampatilwrites--baidu-ocr2-sglang-ocr2pdfapi-parse-pdf.us-east.modal.run"
# 2) Raw OpenAI-compatible SGLang server (GPU container) -- for direct use
SERVER_URL = "https://gautampatilwrites--baidu-ocr2-sglang-ocr2sglangserver.us-east.modal.direct"

PDF_PATH = "/Users/gaupatil/repos/GitHub/Security/modal-ocr-tts/test pdf.pdf"
OUTPUT_PATH = "ocr-test-output.md"  # where the returned markdown is saved
DPI = 300                                # PDF rasterization resolution
# =============================================================================

TIMEOUT_SECONDS = 1800  # 30 min: covers cold start + very large PDFs


def parse_pdf(url: str, pdf_path: str, dpi: int) -> tuple[str, float]:
    pdf = pathlib.Path(pdf_path)
    if not pdf.exists():
        raise FileNotFoundError(f"PDF not found: {pdf}")

    print(f"POST {pdf.name} ({pdf.stat().st_size / 1e6:.2f} MB) @ {dpi} dpi")
    print(f" -> {url}")
    print("(first request after idle may take 1-3 min: cold start + model load)")

    t0 = time.time()
    with pdf.open("rb") as f:
        resp = requests.post(
            url,
            files={"pdf": (pdf.name, f, "application/pdf")},
            data={"dpi": str(dpi)},
            timeout=TIMEOUT_SECONDS,
        )
    elapsed = time.time() - t0

    if resp.status_code != 200:
        print(f"\n[FAILED] HTTP {resp.status_code} after {elapsed:.1f}s")
        print(f"Response body:\n{resp.text[:3000]}")
        sys.exit(1)

    print(f"[OK] HTTP 200 in {elapsed:.1f}s, {len(resp.text)} chars of markdown")
    return resp.text, elapsed


def check_server(url: str, max_wait: int = 300) -> None:
    """Ping the raw GPU SGLang server: /health + list models via /v1/models.

    This also WARMS the GPU container (useful to run before the PDF test).
    A 503 means it is cold-starting; we poll until healthy.
    """
    print(f"=== checking raw GPU server: {url}")
    deadline = time.time() + max_wait
    while True:
        try:
            r = requests.get(f"{url}/health", timeout=30)
            if r.status_code == 200:
                break
            print(f"  /health -> HTTP {r.status_code} (cold-starting...)")
        except requests.RequestException as e:
            print(f"  /health -> {type(e).__name__} (cold-starting...)")
        if time.time() > deadline:
            print("  [WARN] server not healthy yet, continuing anyway")
            return
        time.sleep(5)
    try:
        r = requests.get(f"{url}/v1/models", timeout=60)
        models = [m["id"] for m in r.json()["data"]]
        print(f"  [OK] server healthy, serving model(s): {models}")
    except Exception as e:
        print(f"  [OK] server healthy (/v1/models probe failed: {e})")


def ocr_image_direct(url: str, image_path: str) -> str:
    """Demo: send ONE page image straight to the raw GPU server (bypasses the
    CPU wrapper). Returns the model's RAW output (block markers not stripped).
    Use OCR_URL/parse_pdf for PDFs and clean output; use this for custom flows.
    """
    img = pathlib.Path(image_path)
    b64 = base64.b64encode(img.read_bytes()).decode()
    content = [
        {"type": "text", "text": "<image>document parsing."},
        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
    ]
    payload = {
        "model": "Unlimited-OCR-2",
        "messages": [{"role": "user", "content": content}],
        "max_tokens": 8192,
        "temperature": 0,
        "skip_special_tokens": False,
        "images_config": {"crop_mode": True},
        "custom_params": {"ngram_size": 35, "window_size": 128},
        "stream": False,
    }
    resp = requests.post(f"{url}/v1/chat/completions", json=payload, timeout=TIMEOUT_SECONDS)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


def main():
    parser = argparse.ArgumentParser(description="Test the OCR-2 PDF->Markdown endpoint")
    parser.add_argument("--url", default=OCR_URL, help="parse_pdf endpoint URL")
    parser.add_argument("--pdf", default=PDF_PATH, help="path to the PDF file")
    parser.add_argument("--dpi", type=int, default=DPI)
    parser.add_argument("--out", default=OUTPUT_PATH)
    parser.add_argument("--check-server", action="store_true",
                        help="ping the raw GPU server (/health, /v1/models) first")
    parser.add_argument("--image", default=None,
                        help="instead of a PDF, send ONE image directly to the raw GPU server")
    args = parser.parse_args()

    if args.check_server:
        check_server(SERVER_URL)

    if args.image:  # direct raw-server mode (single image)
        print(f"=== sending {args.image} directly to the raw GPU server")
        raw = ocr_image_direct(SERVER_URL, args.image)
        print("----- raw model output (first 1000 chars) -----")
        print(raw[:1000])
        print("------------------------------------------------")
        return

    markdown, elapsed = parse_pdf(args.url, args.pdf, args.dpi)

    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(markdown)
    print(f"\nSaved full markdown -> {out}")

    # quick stats
    n_pages = markdown.count("<!-- page break -->") + 1
    print(f"Pages detected: ~{n_pages} | chars/page: {len(markdown) // n_pages}")
    print("\n----- first 1500 chars -----")
    print(markdown[:1500])
    print("----------------------------")


if __name__ == "__main__":
    main()
