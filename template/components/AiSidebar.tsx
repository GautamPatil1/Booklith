"use client";
/**
 * AiSidebar — Chat / Test / References tabs.
 *
 *  Chat: pinned paragraphs & chapters become TOP-PRIORITY context; the rest of
 *  the book is retrieved lexically (RAG). Answers must cite paragraph ids,
 *  rendered as clickable chips that scroll to the paragraph.
 *  Test: AI-generated multiple-choice quizzes per chapter, each question
 *  cites its source paragraph.
 *  References: the LLM only writes SEARCH QUERIES; URLs come exclusively from
 *  the Tavily search API and are verified with real requests before display —
 *  never from model memory.
 */
import { useRef, useState, useEffect } from "react";
import type { Book } from "../lib/booklith";
import { blobToWav } from "../lib/wav";
import { lsGet, lsPut, bookKey } from "../lib/cache";
import { Spinner } from "./Spinner";
import { AudioTab } from "./AudioTab";
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  citations?: string[];
}
export interface QuizQuestion {
  question: string;
  options: string[];
  answerIndex: number;
  explanation?: string;
  sourceId?: string;
}
export interface Reference {
  url: string;
  title: string;
  snippet: string;
  verified: boolean;
}
interface Props {
  className: string;
  book: Book;
  pinned: string[];
  pinnedChapters: string[];
  onUnpin: (id: string) => void;
  onUnpinChapter: (id: string) => void;
  onFlash: (id: string) => void;
  previewMode?: boolean;
}
export function AiSidebar({ className, book, pinned, pinnedChapters, onUnpin, onUnpinChapter, onFlash, previewMode }: Props) {
  const [tab, setTab] = useState<"chat" | "audio" | "test" | "refs">("chat");
  return (
    <aside className={`bl-ai ${className}`}>
      <div className="bl-ai-tabs">
        <button className={tab === "chat" ? "active" : ""} onClick={() => setTab("chat")}>Chat</button>
        <button className={tab === "audio" ? "active" : ""} onClick={() => setTab("audio")}>Audio</button>
        <button className={tab === "test" ? "active" : ""} onClick={() => setTab("test")}>Test</button>
        <button className={tab === "refs" ? "active" : ""} onClick={() => setTab("refs")}>Refs</button>
      </div>
      {tab === "chat" && <ChatTab book={book} pinned={pinned} pinnedChapters={pinnedChapters} onUnpin={onUnpin} onUnpinChapter={onUnpinChapter} onFlash={onFlash} previewMode={previewMode} />}
      {tab === "audio" && <AudioTab book={book} previewMode={previewMode} />}
      {tab === "test" && <TestTab book={book} previewMode={previewMode} />}
      {tab === "refs" && <RefsTab previewMode={previewMode} />}
    </aside>
  );
}
function Citations({ ids, onFlash }: { ids: string[]; onFlash: (id: string) => void }) {
  if (!ids.length) return null;
  return (
    <div>
      {ids.map((id) => (
        <button key={id} className="bl-cite" onClick={() => onFlash(id)} title="Jump to paragraph">{id}</button>
      ))}
    </div>
  );
}
/** Strip citation chips out of an answer's text, showing them as chips. */
function splitCitations(text: string): { body: string; ids: string[] } {
  const ids: string[] = [];
  const body = text.replace(/\[(p-\d{3,4}|h-\d{3}|tbl-\d{3}|fig-\d{3})\]/g, (_m, id) => {
    if (!ids.includes(id)) ids.push(id);
    return "";
  });
  return { body, ids };
}
function ChatTab({ book, pinned, pinnedChapters, onUnpin, onUnpinChapter, onFlash, previewMode }: {
  book: Book;
  pinned: string[];
  pinnedChapters: string[];
  onUnpin: (id: string) => void;
  onUnpinChapter: (id: string) => void;
  onFlash: (id: string) => void;
  previewMode?: boolean;
}) {
  const chatKey = `chat:${bookKey(book)}`;
  const [messages, setMessages] = useState<ChatMessage[]>(() => lsGet<ChatMessage[]>(chatKey) ?? []);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<{ role: "user" | "assistant"; content: string }[]>(
    () => lsGet<{ role: "user" | "assistant"; content: string }[]>(`${chatKey}:history`) ?? [],
  );
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // persist chat (messages + retrieval history) after every change
  useEffect(() => {
    lsPut(chatKey, messages);
    lsPut(`${chatKey}:history`, history);
  }, [messages, history, chatKey]);

  const clearChat = () => {
    setMessages([]);
    setHistory([]);
  };

  // starter prompts (reference: "Who is Irene Adler?" / "Quiz me on this chapter")
  const suggestions = [
    `What is ${book.meta.title.replace(/^(the|a|an)\s+/i, "")} about?`,
    "Summarize the first chapter",
    "Who are the main characters?",
  ];
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: rec.mimeType });
        setTranscribing(true);
        try {
          const wav = await blobToWav(blob);
          const form = new FormData();
          form.append("audio", wav, "recording.wav");
          const res = await fetch("/api/voice", { method: "POST", body: form });
          const data = (await res.json()) as { transcript?: string; error?: string };
          if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
          if (data.transcript) setInput((cur) => (cur ? `${cur} ${data.transcript}` : data.transcript!));
        } catch (err) {
          alert(`Voice input error: ${(err as Error).message}`);
        } finally {
          setTranscribing(false);
        }
      };
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
    } catch {
      alert("Microphone permission denied.");
    }
  };
  const stopRecording = () => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  };
  const send = async () => {
    const question = input.trim();
    if (!question || busy) return;
    if (previewMode) {
      setMessages((m) => [...m, { role: "user", content: question }, { role: "assistant", content: "Chat is disabled in preview mode — it works in the exported site once API_KEY is set." }]);
      setInput("");
      return;
    }
    setBusy(true);
    setMessages((m) => [...m, { role: "user", content: question }]);
    setInput("");
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, pinned, pinnedChapters, history: history.slice(-6) }),
      });
      const data = (await res.json()) as { answer?: string; citations?: string[]; error?: string };
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      setMessages((m) => [...m, { role: "assistant", content: data.answer ?? "", citations: data.citations ?? [] }]);
      setHistory((h) => [...h, { role: "user", content: question }, { role: "assistant", content: data.answer ?? "" }]);
    } catch (err) {
      setMessages((m) => [...m, { role: "assistant", content: `⚠ ${(err as Error).message}` }]);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="bl-ai-body">
        {pinned.length + pinnedChapters.length > 0 && (
          <div className="bl-pin-status">
            <span className="dot" />
            <span>
              {pinned.length > 0 && `${pinned.length} paragraph${pinned.length > 1 ? "s" : ""}`}
              {pinned.length > 0 && pinnedChapters.length > 0 && " + "}
              {pinnedChapters.length > 0 && `${pinnedChapters.length} chapter${pinnedChapters.length > 1 ? "s" : ""}`}
              {" "}pinned as top-priority context
            </span>
            {messages.length > 0 && (
              <button className="bl-btn bl-clear" style={{ marginLeft: "auto" }} title="Clear chat history" onClick={clearChat}>🗑</button>
            )}
          </div>
        )}
        {(pinned.length > 0 || pinnedChapters.length > 0) && (
          <div className="bl-pin-list">
            {pinnedChapters.map((id) => {
              const ch = book.chapters.find((c) => c.id === id);
              return (
                <span key={id} className="chip" title="Unpin chapter" onClick={() => onUnpinChapter(id)}>📖 {ch?.title ?? id} ✕</span>
              );
            })}
            {pinned.map((id) => (
              <span key={id} className="chip" title="Unpin paragraph" onClick={() => onUnpin(id)}>{id} ✕</span>
            ))}
          </div>
        )}
        {messages.length === 0 && (
          <>
            <p style={{ color: "var(--bl-muted)", fontSize: "0.78rem", lineHeight: 1.5 }}>
              Ask anything about <em>{book.meta.title}</em>. Hover a paragraph and press <strong>Pin</strong> to make it top-priority context. Answers cite paragraph ids — click to jump.
            </p>
            <div className="bl-suggest">
              {suggestions.map((s) => (
                <button key={s} onClick={() => { setInput(s); }}>{s}</button>
              ))}
            </div>
          </>
        )}
        {messages.map((m, i) => {
          const { body, ids } = m.role === "assistant" ? splitCitations(m.content) : { body: m.content, ids: [] as string[] };
          return (
            <div key={i}>
              <div className={`bl-msg ${m.role === "user" ? "user" : ""}`}>{body}</div>
              <Citations ids={m.role === "assistant" ? (m.citations && m.citations.length ? m.citations : ids) : []} onFlash={onFlash} />
            </div>
          );
        })}
        {busy && (
          <div className="bl-msg bl-loading">
            <Spinner size={14} /> Thinking…
          </div>
        )}
      </div>
      <div className="bl-ai-input">
        <textarea
          placeholder="Ask about the book…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="row">
          <button
            className={`bl-btn ${recording ? "on" : ""}`}
            title={recording ? "Stop & transcribe (Muse Voice)" : "Speak your question (Muse Voice Transcribe)"}
            onClick={recording ? stopRecording : startRecording}
            disabled={previewMode || transcribing}
          >
            {transcribing ? <Spinner size={12} /> : recording ? "⏹" : "🎤"}
          </button>
          <div className="grow" />
          <button className="bl-btn primary" onClick={send} disabled={busy}>Send</button>
        </div>
      </div>
    </>
  );
}
function TestTab({ book, previewMode }: { book: Book; previewMode?: boolean }) {
  const [chapterId, setChapterId] = useState(book.chapters[0]?.id ?? "");
  const quizKey = `quiz:${bookKey(book)}:${chapterId}`;
  const [questions, setQuestions] = useState<QuizQuestion[]>(() => lsGet<QuizQuestion[]>(quizKey) ?? []);
  const [picked, setPicked] = useState<(number | null)[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);

  // switching chapters loads the cached quiz instantly (if one exists)
  useEffect(() => {
    const cached = lsGet<QuizQuestion[]>(quizKey);
    setQuestions(cached ?? []);
    setPicked(new Array((cached ?? []).length).fill(null));
    setFromCache(!!cached && cached.length > 0);
    setError(null);
  }, [quizKey]);

  const generate = async (replace = false) => {
    if (previewMode) {
      setError("Quizzes are disabled in preview mode — they work in the exported site once API_KEY is set.");
      return;
    }
    if (fromCache && !replace) return; // cached set already displayed
    setBusy(true);
    setError(null);
    try {
      const chapter = book.chapters.find((item) => item.id === chapterId);
      const paragraphs = chapter
        ? chapter.blockIds.flatMap((id) => {
            const block = book.blocks.find((item) => item.id === id);
            return block?.type === "paragraph" ? [{ id: block.id, text: block.text.slice(0, 700) }] : [];
          })
        : [];
      const res = await fetch("/api/quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chapterId, chapterTitle: chapter?.title, paragraphs, count: 5 }),
      });
      if (!res.headers.get("content-type")?.includes("application/json")) {
        throw new Error(`Quiz API returned HTTP ${res.status} without JSON. Check that this deployment includes the quiz API route.`);
      }
      const data = (await res.json()) as { questions?: QuizQuestion[]; error?: string };
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      const qs = data.questions ?? [];
      setQuestions(qs);
      setPicked(new Array(qs.length).fill(null));
      setFromCache(true);
      lsPut(quizKey, qs); // cache for next time; "New questions" replaces it
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="bl-ai-body">
      <p style={{ color: "var(--bl-muted)", fontSize: "0.75rem" }}>AI-generated practice questions from the chapter text, each citing its source paragraph.</p>
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        <select value={chapterId} onChange={(e) => setChapterId(e.target.value)} className="bl-btn" style={{ flex: 1 }}>
          {book.chapters.map((c) => (
            <option key={c.id} value={c.id}>{c.title}</option>
          ))}
        </select>
        <button className="bl-btn primary" onClick={() => generate(fromCache)} disabled={busy}>
          {busy ? <><Spinner size={12} /> Generating</> : questions.length > 0 ? "↻ New questions" : "Generate"}
        </button>
      </div>
      {error && <div className="bl-msg error">⚠ {error}</div>}
      {questions.map((q, qi) => (
        <div key={qi} className="bl-quiz-q">
          <div className="q">{qi + 1}. {q.question}</div>
          {q.options.map((opt, oi) => {
            const chosen = picked[qi];
            let cls = "";
            if (chosen != null) {
              if (oi === q.answerIndex) cls = "right";
              else if (oi === chosen) cls = "wrong";
            }
            return (
              <button
                key={oi}
                className={`opt ${cls}`}
                disabled={picked[qi] != null}
                onClick={() => setPicked((p) => p.map((x, i) => (i === qi ? oi : x)))}
              >
                {opt}
              </button>
            );
          })}
          {picked[qi] != null && (
            <div style={{ fontSize: "0.78rem", color: "var(--bl-muted)", marginTop: "0.4rem" }}>
              {q.explanation} {q.sourceId && <span className="bl-cite">{q.sourceId}</span>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
function RefsTab({ previewMode }: { previewMode?: boolean }) {
  const [topic, setTopic] = useState("");
  const [refs, setRefs] = useState<Reference[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const find = async () => {
    const q = topic.trim();
    if (!q || busy) return;
    if (previewMode) {
      setError("References are disabled in preview mode — they work in the exported site once keys are set.");
      return;
    }
    setBusy(true);
    setError(null);
    setRefs([]);
    try {
      const res = await fetch("/api/references", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      });
      const data = (await res.json()) as { references?: Reference[]; error?: string };
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      setRefs(data.references ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="bl-ai-body">
      <p style={{ color: "var(--bl-muted)", fontSize: "0.75rem" }}>
        Finds further reading on the web. URLs come from a live search API and are verified with real requests — never from the model&apos;s memory.
      </p>
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        <input
          className="bl-search-input"
          style={{ maxWidth: "none" }}
          placeholder="Topic, claim, or question…"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && find()}
        />
        <button className="bl-btn primary" onClick={find} disabled={busy}>{busy ? <Spinner size={12} /> : "Find"}</button>
      </div>
      {error && <div className="bl-msg error">⚠ {error}</div>}
      {refs.map((r, i) => (
        <div key={i} className="bl-ref">
          <div className="title">{r.title}</div>
          <a href={r.url} target="_blank" rel="noopener noreferrer">{r.url}</a>
          <div className="snip">{r.snippet}</div>
          <div className="src">{r.verified ? "✓ URL verified" : "unverified"}</div>
        </div>
      ))}
    </div>
  );
}
