# Booklith

**Give every book its own reader.** Booklith turns a PDF into a structured, validated book and exports it as a complete AI-powered website you can own and deploy.

Built for the [Meta Global AI Developer Hackathon](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/details), Booklith combines Meta models for book-aware features with optional OCR and speech services that run in infrastructure you control.

## What Booklith does

1. **Bring in a book.** Upload a PDF to your Baidu Unlimited-OCR-2 Modal endpoint, or explore a prebuilt sample reader.
2. **Turn it into a book structure.** OCR Markdown becomes chapters and stable IDs for paragraphs, figures, and tables.
3. **Let AI organize, not rewrite.** The optional AI harness can group chapters, suggest titles, and choose a theme. It does not write or edit the book text.
4. **Check the source.** An integrity validator catches text that was changed, omitted, added, or reordered.
5. **Preview and export.** Check the reader, then publish the self-contained Next.js app to your GitHub repository in one commit or download it as a zip.

```text
PDF -> Baidu OCR Markdown -> Book JSON -> AI structure and theme -> integrity check
                                                                 -> live reader preview
                                                                 -> GitHub export or zip
```

## Try it locally

You need Node.js and npm. The Sherlock Holmes and Vinoba reader demos load without OCR; AI features such as translation need an API key.

```bash
npm install
npm run dev
```

Open [http://localhost:3000/build](http://localhost:3000/build) to upload a PDF with your Baidu Unlimited-OCR-2 Modal `parse_pdf` URL. Or open the live [Sherlock Holmes demo](/demo1) and [Vinoba demo](/demo2).

To enable translation in local demos, copy `builder/.env.example` to
`builder/.env.local` and set `API_KEY`. `API_BASE_URL` and `API_MODEL` are
optional when using the defaults.

Useful commands:

```bash
npm run dev:reader     # run the reader template with its sample book
npm test               # run core pipeline and validator tests
npm run build          # build the Builder
```

## How the book pipeline works

- **OCR stays under your control.** The Builder currently exposes Baidu Unlimited-OCR-2 only. The browser sends the PDF directly to your Modal OCR URL; it does not upload the PDF through Booklith's server. The prebuilt sample demos do not need OCR.
- **Stable source references.** Paragraphs, headings, figures, and tables receive IDs so the reader and AI features can point back to specific parts of a book.
- **AI edits metadata only.** The harness sees a compact outline and may organize chapters or choose a theme. It never supplies replacement book text.
- **Integrity is checked before export.** The validator compares the result to the source snapshot and blocks export if text has been altered, lost, invented, or reordered. The exported app includes the validator (`npm run validate`).

## Models and services

| Model or service | Booklith use |
|---|---|
| Meta Muse Wonder (`muse-wonder-1.0`) | Organizes OCR output into chapters and metadata. |
| Meta Muse Spark (`muse-spark-1.3`) | Helps choose themes and powers reader chat, translation, quizzes, and reference queries. |
| Meta Muse Voice Transcribe (`muse-voice-transcribe-1.0`) | Turns spoken questions into text for the reader's chat. |
| Meta search grounding | Finds reference URLs from live search results; Booklith verifies those URLs before showing them. |
| Baidu Unlimited-OCR-2 on Modal | Optional PDF-to-Markdown OCR deployment. |
| OmniVoice on Modal | Optional read-aloud service with support for 600+ languages and voice cloning. |
| Microsoft Edge TTS | Keyless read-aloud option; no deployment URL is required. |

The exported reader also supports OpenAI-compatible LLM providers, including OpenAI, Groq, and OpenRouter. Tavily can provide reference search with those providers.

## The exported reader

The export is a standalone Next.js application, not a static page. It includes:

- Chapter navigation, full-text search, typography and theme controls, and night mode.
- Book-grounded chat with lexical retrieval, pinned context, and clickable paragraph citations.
- Per-paragraph translation with a local cache.
- Read-aloud defaults to Edge TTS, with a choice of Automatic or OmniVoice. Automatic preserves the OmniVoice → Edge → browser fallback chain; an explicitly selected provider reports an error instead of silently switching.
- Chapter quizzes with source paragraph citations.
- Reference search with URL verification.

The app's API routes use keys configured in your own deployment environment. See the generated `.env.example` for the available settings.

## Run OCR and speech on your own account

These services are optional. Edge TTS works without a deployment. To enable OmniVoice and voice cloning, deploy it with Modal:

```bash
pip install -U modal
modal setup
modal deploy modal/ocr2_modal.py
modal deploy modal/omnivoice_tts_modal.py
```

Use the printed OCR `parse_pdf` URL in the Builder. OCR-2 is best suited to English and Chinese. To support another OCR engine, implement an `OcrProvider` and add it to the Builder. GPU services scale to zero when idle, though the first request may take a few minutes to start.

## Privacy and ownership

- PDFs go from the browser directly to the OCR endpoint you configure.
- Provider credentials are never bundled into the exported source. Reader API keys belong in your own deployment environment.
- GitHub publishing uses the PAT entered in the Builder and creates the repository under the account GitHub authenticates for that PAT. The PAT stays in that browser session; local Git credentials are not used.
- Your exported site, book content, and deployment belong to you. Booklith does not host your book or require an account.
- The validator guards the original text throughout the pipeline and before export.

## Project layout

```text
packages/core/   Shared Book JSON types, OCR-to-book pipeline, validator, and AI harness
builder/         Booklith web app and client-side export flow
template/        Self-contained Next.js reader used for exports
modal/           Optional OCR and OmniVoice deployment scripts
sample/          Pre-converted Sherlock Holmes and Vinoba source books
scripts/         Template embedding, sample generation, and export checks
```

## License

MIT. See [LICENSE](LICENSE).
