"use client";

/**
 * Step 3: export — entirely client-side.
 *  a) GitHub: create the repo if needed, push the whole reader app as ONE
 *     commit via the Git Data API (PAT lives only in this tab), then hand the
 *     user a "Deploy to Vercel" link that pre-fills the env var KEYS (values
 *     are entered by the user in Vercel's flow — we never touch them).
 *  b) Zip fallback: download the full app and deploy anywhere.
 * Export is blocked if the validator isn't green.
 */

import { useState } from "react";
import type { Book, SourceText } from "@booklith/core";
import { generateReaderFiles, totalBytes } from "../export/templateFiles";
import { publishToGithub, type PublishResult } from "../export/github";
import { downloadZip } from "../export/zip";

interface Props {
  book: Book;
  source: SourceText[];
  valid: boolean;
  onDone: () => void;
}

export function ExportStep({ book, source, valid }: Props) {
  const [token, setToken] = useState("");
  const [repoName, setRepoName] = useState("my-book-site");
  const [isPrivate, setIsPrivate] = useState(false);
  const [ttsUrl, setTtsUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string[]>([]);
  const [published, setPublished] = useState<PublishResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const files = generateReaderFiles(book, source, { ttsUrl: ttsUrl || undefined });

  const push = async () => {
    setBusy(true);
    setError(null);
    setPublished(null);
    setProgress([]);
    try {
      const res = await publishToGithub(
        files,
        { token, repoName, private: isPrivate },
        (m) => setProgress((p) => [...p.slice(-6), m]),
      );
      setPublished(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="bb-card">
      <h2><span className="step">3</span> Export</h2>
      <p className="bb-muted">
        The exported site is a <strong>full Next.js app</strong> with serverless API routes for chat,
        translation, TTS, quizzes and references — your keys are set as env vars in your own Vercel
        project, never baked into the repo. Export runs in <strong>your browser</strong> via the GitHub API
        ({Object.keys(files).length} files, {(totalBytes(files) / 1024).toFixed(0)} KB) — nothing is uploaded to Booklith.
      </p>
      {!valid && (
        <div className="bb-err">⚠ Export is blocked: the book failed integrity validation. No paragraph may be altered or lost.</div>
      )}
      <div className="bb-kv">
        <label>GitHub PAT <span className="bb-muted">(classic &quot;repo&quot; scope, or fine-grained Contents+Administration write)</span></label>
        <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="ghp_… (stays in this tab)" />
      </div>
      <div className="bb-kv">
        <label>Repository name</label>
        <input value={repoName} onChange={(e) => setRepoName(e.target.value)} />
      </div>
      <div className="bb-kv">
        <label>OmniVoice Modal TTS URL <span className="bb-muted">(optional — your read-aloud endpoint)</span></label>
        <input value={ttsUrl} onChange={(e) => setTtsUrl(e.target.value)} placeholder="https://<workspace>--omnivoice-tts-omnivoicetts-clone.modal.run" />
        <div className="hint">From <code>modal deploy modal/omnivoice_tts_modal.py</code> (the POST/clone URL). If set, read-aloud works out of the box; you can also set <code>MODAL_TTS_URL</code> in Vercel later. Leave empty and the reader falls back to keyless Edge/online voices automatically.</div>
      </div>
      <div className="bb-kv">
        <label>Visibility</label>
        <select value={isPrivate ? "private" : "public"} onChange={(e) => setIsPrivate(e.target.value === "private")}>
          <option value="public">Public (needed for Vercel Hobby + Deploy link)</option>
          <option value="private">Private</option>
        </select>
      </div>
      <div className="bb-row" style={{ marginTop: "0.9rem" }}>
        <button className="bb-btn green" disabled={busy || !valid || !token || !repoName} onClick={push}>
          {busy ? "Publishing…" : "🚀 Push to GitHub (one commit)"}
        </button>
        <button className="bb-btn" disabled={!valid} onClick={() => downloadZip(files, book.meta.title)}>
          📁 Download zip instead
        </button>
      </div>
      {progress.length > 0 && <div className="bb-log">{progress.join("\n")}</div>}
      {error && <div className="bb-err">⚠ {error}</div>}
      {published && (
        <div className="bb-final" style={{ marginTop: "0.9rem" }}>
          <div className="bb-ok">✓ Booklith files pushed as one commit ({published.commitSha.slice(0, 8)})</div>
          <a href={published.repoUrl} target="_blank" rel="noopener noreferrer">→ {published.repoUrl}</a>
          <a href={published.vercelUrl} target="_blank" rel="noopener noreferrer" className="bb-btn primary" style={{ display: "inline-block", textDecoration: "none", width: "fit-content" }}>
            ▲ Deploy to Vercel
          </a>
          <div className="bb-muted">
            The Vercel flow asks for your OpenAI / Modal / Tavily keys — set them as project env vars
            (the repo ships a .env.example listing them). Vercel never sees Booklith.
          </div>
        </div>
      )}
    </section>
  );
}
