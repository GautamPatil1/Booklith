"""
Baidu "OCR 2" (`baidu/Unlimited-OCR-2`) as a serverless HTTP API on Modal.
Send a PDF (or an image) over HTTP, get Markdown back.

Research notes (verified 2026-11-02):
  * The Baidu OCR-2 model on Hugging Face is `baidu/Unlimited-OCR-2`
    ("Unlimited OCR Works 2", MIT license, arXiv:2610.39308, released 2026-10-27).
    There is no separate "baidu/OCR-2" repo.
  * OCR-2 is NOT (yet) supported by vLLM. Upstream supports Transformers
    (native, trust_remote_code) and SGLang (recommended for high-throughput
    serving; needs their custom SGLang wheel -- see the model card:
    https://huggingface.co/baidu/Unlimited-OCR-2).
    This deployment uses the native Transformers path, which is the simplest
    reliable way to get pay-per-use serverless inference on Modal.
  * vLLM supports only the older v1 model `baidu/Unlimited-OCR` — NOT OCR-2.
    For OCR-2 with an OpenAI-compatible serving API, use the SGLang variant:
    `ocr2_sglang_modal.py` in this folder.

Usage:
    modal deploy modal-ocr-tts/ocr2_modal.py     # deploy (idle = $0, pay per second)
    modal run modal-ocr-tts/ocr2_modal.py --pdf-path /path/to/doc.pdf

HTTP API (URLs are printed when you deploy):
    curl -X POST "https://<workspace>--baidu-ocr2-unlimitedocr2-parse-pdf.modal.run" \
         -F "pdf=@/path/to/doc.pdf" -o doc.md
    curl -X POST "https://<workspace>--baidu-ocr2-unlimitedocr2-parse-image.modal.run" \
         -F "image=@/path/to/page.png" -o page.md
"""

import fastapi
import modal

MINUTES = 60
MODEL_ID = "baidu/Unlimited-OCR-2"

# Pinned to the versions Baidu tested with (see "Inference > Transformers" in
# the model card: Python 3.10, torch 2.13.0, transformers 4.52.1, ...).
image = (
    modal.Image.debian_slim(python_version="3.10")
    .uv_pip_install(
        "torch==2.13.0",
        "torchvision",
        "pillow",
        "transformers==4.52.1",
        "huggingface-hub==0.36.0",
        "tokenizers==0.21.4",
        "addict==2.4.0",
        "einops==0.8.2",
        "easydict==1.13",
        "pymupdf==1.27.2.2",  # PDF -> page images
        "fastapi[standard]==0.124.4",
    )
)

# Cache model weights between cold starts so you only download them once.
hf_cache_vol = modal.Volume.from_name("huggingface-cache", create_if_missing=True)

app = modal.App("baidu-ocr2", image=image)


@app.cls(
    # Upstream tested on an A800-80GB; a100-40gb is fine for typical documents.
    # For huge (100+ page) PDFs use gpu="a100-80gb" / "h200".
    gpu="a100-40gb",
    scaledown_window=1 * MINUTES,  # minimum: stop billing 60s after the last request
    timeout=45 * MINUTES,  # very large documents can take a while
    volumes={"/root/.cache/huggingface": hf_cache_vol},
    # If you hit HF rate limits or want faster downloads, add a token:
    # secrets=[modal.Secret.from_name("huggingface")],
)
@modal.concurrent(max_inputs=2)  # VRAM-heavy: don't pack too many requests per GPU
class UnlimitedOCR2:
    @modal.enter()
    def load(self):
        import torch
        from transformers import AutoModel, AutoTokenizer

        self.tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, trust_remote_code=True)
        self.model = (
            AutoModel.from_pretrained(
                MODEL_ID,
                trust_remote_code=True,
                use_safetensors=True,
                torch_dtype=torch.bfloat16,
            )
            .eval()
            .cuda()
        )

    # ---- core inference (callable from Python via .remote()) ----------------
    @modal.method()
    def parse_images_bytes(self, images: list[bytes], exts: list[str] | None = None) -> str:
        """Parse one or more page images (PNG/JPEG bytes) -> raw Markdown."""
        import os
        import tempfile

        if exts is None:
            exts = ["png"] * len(images)

        with tempfile.TemporaryDirectory() as td:
            paths = []
            for i, (data, ext) in enumerate(zip(images, exts)):
                p = os.path.join(td, f"page_{i + 1:04d}.{ext.lstrip('.')}")
                with open(p, "wb") as f:
                    f.write(data)
                paths.append(p)

            if len(paths) == 1:
                # gundam mode (dynamic tiling) by default for single pages
                text = self.model.infer(
                    self.tokenizer,
                    image_file=paths[0],
                    output_path=td,
                    save_results=True,
                )
            else:
                # all pages parsed in ONE request -> cross-page context
                text, _num_tokens = self.model.infer_multi(
                    self.tokenizer,
                    image_files=paths,
                    output_path=td,
                    save_results=True,
                )
        return text

    @modal.method()
    def parse_pdf_bytes(self, pdf: bytes, dpi: int = 300) -> str:
        import fitz  # PyMuPDF

        images, exts = [], []
        with fitz.open(stream=pdf, filetype="pdf") as doc:
            mat = fitz.Matrix(dpi / 72, dpi / 72)
            for page in doc:
                images.append(page.get_pixmap(matrix=mat).tobytes("png"))
                exts.append("png")
        if not images:
            raise ValueError("PDF contains no pages")
        return self.parse_images_bytes.local(images, exts)

    # ---- HTTP endpoints -----------------------------------------------------
    @modal.fastapi_endpoint(method="POST", docs=True)
    async def parse_pdf(
        self,
        pdf: fastapi.UploadFile = fastapi.File(...),
        dpi: int = fastapi.Form(300),
        clean: bool = fastapi.Form(True),
    ):
        """POST a PDF file (multipart field `pdf`) -> Markdown text."""
        raw = self.parse_pdf_bytes.local(await pdf.read(), dpi)
        md = postprocess(raw, clean=clean)
        return fastapi.Response(content=md, media_type="text/markdown")

    @modal.fastapi_endpoint(method="POST", docs=True)
    async def parse_image(
        self,
        image: fastapi.UploadFile = fastapi.File(...),
        clean: bool = fastapi.Form(True),
    ):
        """POST an image file (multipart field `image`) -> Markdown text."""
        raw = self.parse_images_bytes.local([await image.read()])
        md = postprocess(raw, clean=clean)
        return fastapi.Response(content=md, media_type="text/markdown")


# ---- output post-processing (adapted from Baidu's model cards) ---------------
def postprocess(raw: str, clean: bool = True) -> str:
    """Unwrap <|ref|> anchors and drop <|det|> boxes / <PAGE> markers."""
    import re

    text = re.sub(r"<\|ref\|>(.*?)<\|/ref\|>", r"\1", raw, flags=re.DOTALL)
    if clean:
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
    # OCR-2 separates pages with literal <PAGE> markers
    text = text.replace("<PAGE>", "\n\n<!-- page break -->\n\n")
    text = re.sub(r"\n{3,}", "\n\n", text)  # collapse extra blank lines
    text = re.sub(r"^\s*<!-- page break -->\s*", "", text)  # drop leading marker
    return text.strip()


# ---- quick test --------------------------------------------------------------
@app.local_entrypoint()
def main(
    pdf_path: str | None = None,
    image_path: str | None = None,
    dpi: int = 300,
    output_path: str = "/tmp/ocr2-output.md",
):
    import pathlib

    ocr = UnlimitedOCR2()
    if pdf_path:
        md = ocr.parse_pdf_bytes.remote(pathlib.Path(pdf_path).read_bytes(), dpi)
    elif image_path:
        md = ocr.parse_images_bytes.remote([pathlib.Path(image_path).read_bytes()])
    else:
        raise SystemExit("Pass --pdf-path or --image-path")

    pathlib.Path(output_path).write_text(md)
    print(md[:2000])
    print(f"\n[full markdown saved to {output_path}]")
