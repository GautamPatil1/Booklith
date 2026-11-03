"use client";

/**
 * Reader — the fixed template's main client component.
 * Takes the Book as a PROP (never imports content/book.json) so the Builder
 * can render a live preview of the exact same components.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Book } from "../lib/booklith";
import { getTheme } from "../lib/booklith";
import { AiSidebar } from "./AiSidebar";
import { BlockView } from "./BlockView";

export interface ReaderProps {
  book: Book;
  /** Builder preview mode: disable network features (chat/tts/translate). */
  previewMode?: boolean;
}

const ORDINALS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX"];

export default function Reader({ book, previewMode }: ReaderProps) {
  const theme = getTheme(book.theme.id);
  const blocksById = useMemo(() => new Map(book.blocks.map((b) => [b.id, b])), [book]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [aiOpen, setAiOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeChapter, setActiveChapter] = useState<string | null>(book.chapters[0]?.id ?? null);
  const [pinned, setPinned] = useState<string[]>([]);
  const [pinnedChapters, setPinnedChapters] = useState<string[]>([]);
  const [night, setNight] = useState(false);
  const [progress, setProgress] = useState(0);
  const mainRef = useRef<HTMLDivElement>(null);
  const rafPending = useRef(false);

  const palette = night ? getTheme("midnight").palette : theme.palette;

  // Apply theme vars on <html> so EVERYTHING follows (body, scrollbars, drawers),
  // not just elements below .bl-root. This is what makes night mode actually work.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--bl-bg", palette.bg);
    root.style.setProperty("--bl-surface", palette.surface);
    root.style.setProperty("--bl-text", palette.text);
    root.style.setProperty("--bl-muted", palette.muted);
    root.style.setProperty("--bl-accent", palette.accent);
    root.style.setProperty("--bl-accent-text", palette.accentText);
    root.style.setProperty("--bl-border", palette.border);
    root.style.colorScheme = palette.dark ? "dark" : "light";
  }, [palette]);

  const styleVars = {} as React.CSSProperties; // vars live on <html> now

  // reading progress + active-chapter tracking while scrolling
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const onScroll = () => {
      if (rafPending.current) return;
      rafPending.current = true;
      requestAnimationFrame(() => {
        rafPending.current = false;
        const max = el.scrollHeight - el.clientHeight;
        setProgress(max > 0 ? Math.min(100, (el.scrollTop / max) * 100) : 0);
        let current: string | null = null;
        for (const c of book.chapters) {
          const head = document.getElementById(c.id);
          if (head && head.offsetTop - el.scrollTop < 140) current = c.id;
        }
        if (current) setActiveChapter(current);
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [book.chapters]);

  const flashBlock = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("flash");
    setTimeout(() => el.classList.remove("flash"), 1600);
  }, []);

  const closeDrawers = useCallback(() => {
    setSidebarOpen(false);
    setAiOpen(false);
  }, []);

  // keyboard: "/" focuses search, Escape closes drawers
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if (e.key === "/" && !typing) {
        e.preventDefault();
        document.querySelector<HTMLInputElement>(".bl-search-input")?.focus();
      } else if (e.key === "Escape") {
        closeDrawers();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeDrawers]);

  const showTop = progress > 6;

  const togglePin = useCallback((id: string) => {
    setPinned((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }, []);

  const togglePinChapter = useCallback((id: string) => {
    setPinnedChapters((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const out: { id: string; chapterTitle: string; snippet: string }[] = [];
    for (const c of book.chapters) {
      for (const id of c.blockIds) {
        const b = blocksById.get(id);
        if (!b || (b.type !== "paragraph" && b.type !== "heading")) continue;
        const text = b.text;
        const idx = text.toLowerCase().indexOf(q);
        if (idx === -1) continue;
        const start = Math.max(0, idx - 60);
        out.push({
          id: b.id,
          chapterTitle: displayTitle(c.title),
          snippet: (start > 0 ? "…" : "") + text.slice(start, start + 160) + "…",
        });
        if (out.length >= 50) return out;
      }
    }
    return out;
  }, [query, book, blocksById]);

  const paragraphCount = useMemo(() => book.blocks.filter((b) => b.type === "paragraph").length, [book]);
  const activeChapterIndex = useMemo(() => book.chapters.findIndex((c) => c.id === activeChapter), [book, activeChapter]);

  return (
    <div className="bl-root" style={styleVars}>
      <div className="bl-progress" aria-hidden><div className="fill" style={{ width: `${progress}%` }} /></div>
      {(sidebarOpen || aiOpen) && <div className="bl-overlay" onClick={closeDrawers} aria-hidden />}

      <aside className={`bl-sidebar bl-panel ${sidebarOpen ? "" : "hidden"}`}>
        <div className="bl-bookcard">
          <div className="bl-cover" aria-hidden>{(book.meta.title.replace(/^(the|a|an)\s+/i, "").trim()[0] ?? "B").toUpperCase()}</div>
          <div>
            <h1>{book.meta.title}</h1>
            <p className="bl-author">{book.meta.authors.length > 0 ? book.meta.authors.join(", ") : "Unknown author"}</p>
          </div>
        </div>
        <div className="bl-stats">{book.chapters.length} chapters · {paragraphCount.toLocaleString()} paragraphs</div>
        <div className="bl-bar" aria-hidden><div className="fill" style={{ width: `${progress}%` }} /></div>
        {book.chapters.map((c, i) => (
          <button
            key={c.id}
            className={`bl-chapter ${activeChapter === c.id ? "active" : ""}`}
            onClick={() => flashBlock(c.id)}
            title={`Go to ${c.title}`}
          >
            <span className="num">{i}</span>
            <span>{displayTitle(c.title)}</span>
          </button>
        ))}
        <div className="bl-foot">Built with Booklith · answers cite the exact paragraph.</div>
      </aside>

      <div className="bl-main bl-panel" ref={mainRef}>
        <div className="bl-topbar">
          {!sidebarOpen && (
            <button className="bl-btn" onClick={() => setSidebarOpen(true)} aria-label="Open contents" title="Contents">☰</button>
          )}
          <div className="bl-crumb">
            {activeChapterIndex >= 0 ? <>Chapter {activeChapterIndex} · <b>{displayTitle(book.chapters[activeChapterIndex]?.title ?? "")}</b></> : <b>{book.meta.title}</b>}
          </div>
          <div className="grow" />
          <button className="bl-btn" onClick={() => setSidebarOpen((v) => !v)} title="Toggle contents">Aa</button>
          <button className="bl-btn" onClick={() => setNight((v) => !v)} title="Night mode">{night ? "☀ Day" : "☾ Night"}</button>
          <button className={`bl-btn ${aiOpen ? "on" : ""}`} onClick={() => setAiOpen((v) => !v)} title="AI panel — ask the book anything">✦ AI</button>
          <div className="bl-search-wrap">
            <input
              className={`bl-search-input ${query ? "open" : ""}`}
              placeholder="Search the book…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search the book"
            />
          </div>
          <button className="bl-btn" title="Search (press /)" onClick={() => document.querySelector<HTMLInputElement>(".bl-search-input")?.focus()}>Search</button>
          {showTop && (
            <button className="bl-btn bl-totop" title="Back to top" aria-label="Back to top" onClick={() => mainRef.current?.scrollTo({ top: 0, behavior: "smooth" })}>↑</button>
          )}
          {query.trim().length >= 2 && (
            <div className="bl-search-results">
              {results.length === 0 ? (
                <div className="bl-empty">No matches for “{query.trim()}”</div>
              ) : (
                results.map((r) => (
                  <button key={r.id} className="bl-search-item" onClick={() => { flashBlock(r.id); setQuery(""); }}>
                    <div className="where">{r.chapterTitle} · {r.id}</div>
                    <div className="snippet">{highlight(r.snippet, query)}</div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        <div className="bl-content">
          <header className="bl-hero">
            <div className="kicker">A Booklith edition · {book.chapters.length} chapters · {paragraphCount.toLocaleString()} paragraphs</div>
            <h1>{book.meta.title}</h1>
            <div className="author">{book.meta.authors.length > 0 ? `by ${book.meta.authors.join(", ")}` : book.meta.language}</div>
            {book.meta.description && <p className="desc">{book.meta.description}</p>}
          </header>

          {book.chapters.map((c, i) => (
            <section key={c.id} className="bl-chapter-section" data-chapter={c.id}>
              <h2 className="bl-chapter-title" id={c.id}>
                <span className="text">{displayTitle(c.title)}</span>
                <span className="overline">Chapter {i} · about {readMinutes(c, blocksById)} min read</span>
              </h2>
              {c.blockIds
                .filter((id) => {
                  const b = blocksById.get(id)!;
                  // a heading identical to the chapter title is already rendered above
                  return !(b.type === "heading" && b.text.trim() === c.title.trim());
                })
                .map((id) => (
                  <BlockView
                    key={id}
                    block={blocksById.get(id)!}
                    pinned={pinned.includes(id)}
                    onPin={() => togglePin(id)}
                    onFlash={flashBlock}
                    previewMode={previewMode}
                    bookLang={book.meta.language}
                    book={book}
                  />
                ))}
              <div className="bl-ornament" aria-hidden />
            </section>
          ))}
        </div>
      </div>

      <AiSidebar
        className={`bl-panel ${aiOpen ? "" : "hidden"}`}
        book={book}
        pinned={pinned}
        pinnedChapters={pinnedChapters}
        onUnpin={togglePin}
        onUnpinChapter={togglePinChapter}
        onFlash={flashBlock}
        previewMode={previewMode}
      />
    </div>
  );
}

function highlight(snippet: string, q: string) {
  const needle = q.trim();
  const idx = snippet.toLowerCase().indexOf(needle.toLowerCase());
  if (idx === -1) return snippet;
  return (
    <>
      {snippet.slice(0, idx)}
      <mark>{snippet.slice(idx, idx + needle.length)}</mark>
      {snippet.slice(idx + needle.length)}
    </>
  );
}

/** Rough reading time for a chapter at ~220 wpm. */
function readMinutes(c: { blockIds: string[] }, blocksById: Map<string, { type: string; text?: string }>): number {
  let words = 0;
  for (const id of c.blockIds) {
    const b = blocksById.get(id);
    if (b && b.type === "paragraph" && b.text) words += b.text.split(/\s+/).length;
  }
  return Math.max(1, Math.round(words / 220));
}

/**
 * Display-only title case for SHOUTING chapter titles (common in Gutenberg /
 * OCR'd books: "I. A SCANDAL IN BOHEMIA" -> "A Scandal in Bohemia"). The
 * book JSON is never modified — this is purely how the nav/headers render.
 */
const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "in", "of", "on", "or", "the", "to", "with"]);
export function displayTitle(raw: string): string {
  let t = raw.trim().replace(/^[IVXLC]{1,5}\.\s+/, "").replace(/^\d{1,3}\.\s+/, ""); // drop "I. " / "12. " prefixes
  const letters = t.replace(/[^A-Za-z]/g, "");
  const upperRatio = letters.length ? letters.replace(/[^A-Z]/g, "").length / letters.length : 0;
  if (upperRatio < 0.8 || letters.length < 4) return t; // already mixed case — leave it
  t = t.toLowerCase();
  return t
    .split(/(\s+|-)/)
    .map((w, i, arr) => {
      if (/^\s+$|^-$/.test(w) || !w) return w;
      const prevSep = i > 0 ? arr[i - 1] : "";
      const first = i === 0 || prevSep === "-";
      if (!first && SMALL_WORDS.has(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join("");
}
