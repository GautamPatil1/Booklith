# My Book — built with [Booklith](https://github.com/booklith/booklith)

An AI-powered reading site generated from a PDF by **Book Builder**:
navigation, full-text search, KaTeX math, themes, and an AI sidebar with
book-grounded chat (citations to paragraph ids), per-paragraph translation,
read-aloud TTS, AI-generated practice tests, and verified web references.
Edge TTS is the default read-aloud engine; OmniVoice is an optional alternative.

## Run it

```bash
npm install
cp .env.example .env.local   # add your keys (see below)
npm run dev
```

## Deploy to Vercel

Import this repo at [vercel.com/new](https://vercel.com/new) and set the
environment variables from `.env.example` in the project settings. All AI
features are **bring-your-own-key** — nothing is hosted by Booklith.

## Environment variables

| Variable | Used by |
|---|---|
| `API_KEY` | chat, translation, quizzes and references through your chosen API |
| `API_BASE_URL` / `API_MODEL` | Optional compatible Chat Completions endpoint and model; defaults to `https://api.openai.com/v1` + `gpt-4o-mini` |
| `API_KEY` + `API_BASE_URL=https://api.meta.ai/v1` | 🎤 voice input (Muse Voice Transcribe) and search-grounded references (`web_search`) |
| `MODAL_TTS_URL` | optional OmniVoice read-aloud and voice cloning (deploy `modal/omnivoice_tts_modal.py`); Edge TTS is also available without a URL |
| `MODAL_TTS_INSTRUCT`, `MODAL_TTS_HEADERS` | voice design; auth headers for the Modal endpoint |
| `TAVILY_API_KEY` | verified web references (non-Meta path only) |

## Integrity

`content/book.json` is the book; `content/source.json` is the OCR snapshot.
`npm run validate` proves no paragraph was altered or lost since the build.

## License

MIT.
