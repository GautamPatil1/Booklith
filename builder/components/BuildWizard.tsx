"use client";

/**
 * BuildWizard — the Booklith product flow, ALL client-side:
 *   1. Source: upload a PDF (POSTed straight from the browser to the user's
 *      Baidu Modal OCR URL — bypasses Vercel's ~4.5 MB body limit).
 *   2. Pipeline: OCR markdown -> Book JSON with stable paragraph ids, plus a
 *      source-of-truth snapshot. The validator must stay green at every step.
 *   3. AI harness (optional, bring-your-own-key): restructure chapters and
 *      pick a theme preset. The model never writes book text.
 *   4. Live preview: the EXACT reader components that will be exported.
 *   5. Export: one commit to the user's GitHub repo (client-side, token in
 *      this tab only) + "Deploy to Vercel" link, or zip fallback.
 */

import { useState } from "react";
import type { Book, BuildResult, SourceText } from "@booklith/core";
import { validateBook } from "@booklith/core";
import { SourceStep } from "./SourceStep";
import { StructureStep } from "./StructureStep";
import { ExportStep } from "./ExportStep";

export default function BuildWizard() {
  const [result, setResult] = useState<BuildResult | null>(null);
  const [book, setBook] = useState<Book | null>(null);
  const [source, setSource] = useState<SourceText[]>([]);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const applyResult = (r: BuildResult, overrides?: Partial<Book>) => {
    const merged: Book = { ...r.book, ...overrides };
    const v = validateBook(merged, r.source);
    setResult(r);
    setSource(r.source);
    setBook(merged);
    setValidationErrors(v.errors);
    setError(v.ok ? null : "The book failed integrity validation — this is a bug, please report it.");
  };

  const updateBook = (b: Book) => {
    const v = validateBook(b, source);
    setBook(b);
    setValidationErrors(v.errors);
  };

  const reset = () => {
    setResult(null);
    setBook(null);
    setSource([]);
    setValidationErrors([]);
    setError(null);
    setDone(false);
  };

  return (
    <div className="bb-shell">
      <nav className="bb-nav" aria-label="Main navigation">
        <a className="bb-logo" href="/">
          <span className="mark">◈</span>
          Booklith
        </a>
        <a className="bb-back" href="/">Back to landing</a>
      </nav>

      <header className="bb-hero">
        <h1>Book Builder</h1>
        <p className="tagline">Turn a PDF book into an exportable, AI-powered book website.</p>
        <div className="bb-badges">
          <span className="bb-badge">🔐 Bring your own keys — they never leave your browser</span>
          <span className="bb-badge">🛰️ PDF → your own Modal OCR (direct upload)</span>
          <span className="bb-badge">✅ Validator: no paragraph altered or lost</span>
          <span className="bb-badge">📦 Export → your GitHub repo (one commit) + Deploy to Vercel</span>
          <span className="bb-badge">📄 MIT · open source</span>
        </div>
      </header>

      <SourceStep
        onBuilt={applyResult}
        onError={setError}
      />

      {book && result && (
        <StructureStep
          book={book}
          source={source}
          result={result}
          validationErrors={validationErrors}
          onBookChange={updateBook}
        />
      )}

      {book && result && (
        <ExportStep
          book={book}
          source={source}
          valid={validationErrors.length === 0}
          onDone={() => setDone(true)}
        />
      )}

      {error && (
        <div className="bb-card">
          <div className="bb-err">⚠ {error}</div>
          <div className="bb-row" style={{ marginTop: "0.6rem" }}>
            <button className="bb-btn" onClick={reset}>Start over</button>
          </div>
        </div>
      )}

      <footer className="bb-footer">
        Booklith · MIT · we host nothing: your PDF goes to <em>your</em> Modal OCR, your keys stay in your browser, and the book site is exported to <em>your</em> GitHub.
      </footer>
    </div>
  );
}
