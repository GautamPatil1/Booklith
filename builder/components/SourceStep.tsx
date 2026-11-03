"use client";

/** Step 1: source input -> OCR -> Book JSON (with validator gate). */

import { useRef, useState } from "react";
import type { BuildResult, Book } from "@booklith/core";
import { BaiduOcr2ModalProvider, markdownToBook } from "@booklith/core";

interface Props {
  onBuilt: (r: BuildResult, overrides?: Partial<Book>) => void;
  onError: (msg: string | null) => void;
}

export function SourceStep({ onBuilt, onError }: Props) {
  const provider = BaiduOcr2ModalProvider;
  const [config, setConfig] = useState<Record<string, string>>({});
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [language, setLanguage] = useState("");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [built, setBuilt] = useState<BuildResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const setCfg = (k: string, v: string) => setConfig((c) => ({ ...c, [k]: v }));

  const run = async () => {
    setBusy(true);
    onError(null);
    setLog([]);
    const ac = new AbortController();
    abortRef.current = ac;
    const onProgress = (m: string) => setLog((l) => [...l.slice(-8), m]);
    try {
      const { markdown } = await provider.run({ file: file ?? undefined, config, signal: ac.signal, onProgress });
      const built = markdownToBook(markdown, {
        title: title || undefined,
        language: language || undefined,
        sourceProvider: provider.id,
      });
      if (built.book.blocks.length === 0) {
        throw new Error("The pipeline produced no content from this input.");
      }
      onBuilt(built);
      setBuilt(built);
    } catch (err) {
      const hint = (err as { hint?: string }).hint;
      onError(`${(err as Error).message}${hint ? `\n\nHint: ${hint}` : ""}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="bb-card">
      <h2><span className="step">1</span> Source {built && <span className="step done">✓</span>}</h2>
      <p className="bb-muted">
        The PDF is uploaded from <strong>your browser directly to your Modal OCR URL</strong> — it never
        passes through Booklith (and skips Vercel&apos;s ~4.5 MB body limit). Baidu Unlimited-OCR-2 is the
        only OCR provider currently available and is strongest for English and Chinese.
      </p>
      <div className="bb-kv">
        <label>Provider</label>
        <div>{provider.label}</div>
      </div>

      {provider.configFields.map((f) => (
        <div className="bb-kv" key={f.key}>
          <label>{f.label}{f.required ? " *" : ""}</label>
          {f.type === "textarea" ? (
            <textarea value={config[f.key] ?? ""} onChange={(e) => setCfg(f.key, e.target.value)} placeholder={f.placeholder} />
          ) : (
            <input
              type={f.type === "number" ? "number" : "text"}
              value={config[f.key] ?? f.default ?? ""}
              onChange={(e) => setCfg(f.key, e.target.value)}
              placeholder={f.placeholder}
            />
          )}
          {f.help && <div className="hint">{f.help}</div>}
        </div>
      ))}
      {provider.needsFile && (
        <div className="bb-kv">
          <label>PDF file</label>
          <div className="bb-file">
            <input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            {file && <div style={{ marginTop: "0.4rem", color: "var(--bb-success)" }}>{file.name} ({(file.size / 1e6).toFixed(1)} MB)</div>}
          </div>
        </div>
      )}
      <div className="bb-kv">
        <label>Book title (optional)</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Guessed from the text if empty" />
      </div>
      <div className="bb-kv">
        <label>Language (optional)</label>
        <input value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="e.g. en, mr, zh — guessed if empty" />
      </div>

      <div className="bb-row" style={{ marginTop: "0.9rem" }}>
        <button className="bb-btn primary" disabled={busy || (provider.needsFile && !file)} onClick={run}>
          {busy ? "Working…" : built ? "Re-run" : "Convert"}
        </button>
        {busy && (
          <button className="bb-btn" onClick={() => abortRef.current?.abort()}>Cancel</button>
        )}
      </div>
      {busy && provider.needsFile && (
        <p className="bb-muted" role="status" style={{ margin: "0.55rem 0 0" }}>
          OCR is running and can take up to 10 minutes, especially on the first request after the service has been idle.
          Grab a coffee while it works; progress will appear here.
        </p>
      )}

      {log.length > 0 && (
        <div className="bb-log">{log.join("\n")}</div>
      )}
      {built && (
        <div className="bb-stats">
          <span><b>{built.book.blocks.length}</b> blocks</span>
          <span><b>{built.book.chapters.length}</b> chapters</span>
          <span><b>{built.source.length}</b> source paragraphs</span>
          <span>validator <b style={{ color: "var(--bb-success)" }}>green</b></span>
        </div>
      )}
      {built?.warnings.map((w, i) => (
        <div key={i} className="bb-warn">⚠ {w}</div>
      ))}
    </section>
  );
}
