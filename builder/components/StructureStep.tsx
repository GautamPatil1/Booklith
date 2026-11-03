"use client";

/**
 * Step 2: AI structure harness + theme + live preview.
 * The LLM only reorders chapter boundaries, writes chapter titles/metadata,
 * and picks a theme preset. The validator re-runs after every change and the
 * preview always shows the exact exported reader.
 */

import { useState } from "react";
import type { Book, BuildResult, SourceText } from "@booklith/core";
import { improveStructure, pickTheme, THEME_CATALOG, getTheme, type LlmConfig } from "@booklith/core";
import Reader from "@template/components/Reader";

interface Props {
  book: Book;
  source: SourceText[];
  result: BuildResult;
  validationErrors: string[];
  onBookChange: (b: Book) => void;
}

export function StructureStep({ book, source, validationErrors, onBookChange }: Props) {
  const [llmPreset, setLlmPreset] = useState("meta");
  const [llmBaseUrl, setLlmBaseUrl] = useState("https://api.meta.ai/v1");
  const [llmKey, setLlmKey] = useState("");
  const [llmModel, setLlmModel] = useState("muse-wonder-1.0");
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [showPreview, setShowPreview] = useState(true);

  const PRESETS: Record<string, { baseUrl: string; model: string; label: string; help: string; effort?: string }> = {
    meta: {
      label: "Meta AI (muse)",
      baseUrl: "https://api.meta.ai/v1",
      model: "muse-wonder-1.0",
      effort: "low",
      help: "Meta's reasoning models. muse-wonder-1.0 = best structure; muse-spark-1.3 = fast & cheap. Reasoning effort is set automatically.",
    },
    openai: {
      label: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      help: "Any OpenAI-compatible API works: Groq, OpenRouter, DeepSeek, local vLLM…",
    },
    custom: {
      label: "Custom…",
      baseUrl: "",
      model: "",
      help: "Bring any /chat/completions endpoint.",
    },
  };

  const applyPreset = (id: string) => {
    setLlmPreset(id);
    const p = PRESETS[id];
    if (p.baseUrl) setLlmBaseUrl(p.baseUrl);
    if (p.model) setLlmModel(p.model);
  };

  const llm: LlmConfig | null = llmKey
    ? { baseUrl: llmBaseUrl, apiKey: llmKey, model: llmModel, ...(llmPreset === "meta" ? { reasoningEffort: PRESETS.meta.effort } : {}) }
    : null;

  const runStructure = async () => {
    if (!llm) return;
    setBusy("structure");
    setNotes([]);
    try {
      const r = await improveStructure(book, source, llm);
      onBookChange(r.book);
      setNotes(r.notes);
    } catch (err) {
      setNotes([`⚠ ${(err as Error).message}`]);
    } finally {
      setBusy(null);
    }
  };

  const runTheme = async () => {
    if (!llm) return;
    setBusy("theme");
    try {
      const { themeId, reason } = await pickTheme(book, llm);
      const preset = getTheme(themeId);
      onBookChange({ ...book, theme: { id: preset.id, name: preset.name } });
      setNotes((n) => [...n, reason]);
    } catch (err) {
      setNotes((n) => [...n, `⚠ ${(err as Error).message}`]);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <section className="bb-card">
        <h2><span className="step">2</span> Structure &amp; theme</h2>
        <p className="bb-muted">
          The AI sees only a compact outline (block ids + short snippets) and may regroup chapters, title
          them, and pick a theme preset. <strong>It never writes book text</strong> — the validator re-checks
          every paragraph after each AI step.
        </p>
        <div className="bb-kv">
          <label>Provider</label>
          <select value={llmPreset} onChange={(e) => applyPreset(e.target.value)}>
            {Object.entries(PRESETS).map(([id, p]) => (
              <option key={id} value={id}>{p.label}</option>
            ))}
          </select>
          <div className="hint">{PRESETS[llmPreset]?.help}</div>
        </div>
        <div className="bb-kv">
          <label>LLM base URL</label>
          <input value={llmBaseUrl} onChange={(e) => setLlmBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" />
        </div>
        <div className="bb-kv">
          <label>API key (stays in this tab)</label>
          <input type="password" value={llmKey} onChange={(e) => setLlmKey(e.target.value)} placeholder="sk-… / LLM_|…" />
        </div>
        <div className="bb-kv">
          <label>Model</label>
          <input value={llmModel} onChange={(e) => setLlmModel(e.target.value)} placeholder="muse-wonder-1.0" />
          <div className="hint">Reasoning models (e.g. Meta muse-*) are supported — extra token headroom is handled automatically.</div>
        </div>
        <div className="bb-row" style={{ marginTop: "0.9rem" }}>
          <button className="bb-btn primary" disabled={!llm || !!busy} onClick={runStructure}>
            {busy === "structure" ? "Restructuring…" : "✨ Improve chapter structure"}
          </button>
          <button className="bb-btn" disabled={!llm || !!busy} onClick={runTheme}>
            {busy === "theme" ? "Picking…" : "🎨 Let the AI pick a theme"}
          </button>
          <button className="bb-btn" onClick={() => setShowPreview((v) => !v)}>
            {showPreview ? "Hide preview" : "Show preview"}
          </button>
        </div>

        <div style={{ marginTop: "0.8rem" }}>
          <div className="bb-muted" style={{ marginBottom: "0.4rem" }}>Theme (presets only — the AI can only choose one):</div>
          <div className="bb-theme-grid">
            {THEME_CATALOG.map((t) => (
              <button
                key={t.id}
                className={`bb-theme-chip ${book.theme.id === t.id ? "sel" : ""}`}
                onClick={() => onBookChange({ ...book, theme: { id: t.id, name: t.name } })}
              >
                {t.name}
              </button>
            ))}
          </div>
        </div>

        <div className="bb-stats" style={{ marginTop: "0.8rem" }}>
          <span>title: <b>{book.meta.title}</b></span>
          <span><b>{book.chapters.length}</b> chapters</span>
          <span>theme: <b>{book.theme.name}</b></span>
          <span>
            validator: {validationErrors.length === 0
            ? <b style={{ color: "var(--bb-success)" }}>green ✓</b>
            : <b style={{ color: "var(--bb-danger)" }}>FAILED ✗</b>}
          </span>
        </div>
        {book.meta.description && <div className="bb-muted">{book.meta.description}</div>}
        {book.chapters.map((c, i) => (
          <div key={c.id} className="bb-muted" style={{ fontSize: "0.78rem" }}>
            {i + 1}. {c.title} <span style={{ color: "var(--bb-muted)" }}>({c.blockIds.length} blocks)</span>
          </div>
        ))}
        {validationErrors.slice(0, 5).map((e, i) => (
          <div key={i} className="bb-err">{e}</div>
        ))}
        {notes.map((n, i) => (
          <div key={i} className="bb-ok">{n}</div>
        ))}
      </section>

      {showPreview && (
        <section className="bb-card">
          <h2><span className="step">👁</span> Live preview <span className="bb-muted" style={{ fontWeight: 400 }}>(the exact exported reader; AI network features run in the exported site)</span></h2>
          <div className="bb-preview-wrap">
            <Reader book={book} previewMode />
          </div>
        </section>
      )}
    </>
  );
}
