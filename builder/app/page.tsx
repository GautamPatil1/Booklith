import "./landing.css";

const STEPS = [
  { n: "1", h: "Upload a PDF", p: "Your browser sends it straight to your own Modal OCR endpoint — no size limits through our servers, because there are none." },
  { n: "2", h: "Structure it", p: "OCR becomes a Book JSON with a stable id on every paragraph, figure and table. Page numbers and running headers are stripped automatically." },
  { n: "3", h: "Let AI shape it", p: "The harness regroups chapters and picks a theme. It never writes book text — a validator blocks export if a single character drifts." },
  { n: "4", h: "Export & deploy", p: "One commit to your GitHub repo, a Deploy-to-Vercel link, and a zip fallback. You own everything." },
];

export default function Landing() {
  return (
    <div className="lp">
      <div className="aurora"><span className="dot3" /></div>
      <div className="lp-grid" />

      <div className="lp-wrap">
        <nav className="lp-nav">
          <div className="lp-logo"><span className="mark">◈</span> Booklith</div>
          <div className="links">
            <a href="#how">How it works</a>
            <a href="#install">Setup</a>
            <a href="#features">Features</a>
            <a href="#models">Models</a>
            <a href="#privacy">Privacy</a>
            <a className="lp-btn primary small" href="/build">Open Builder</a>
          </div>
        </nav>

        <header className="lp-hero">
          <div className="lp-pill"><span className="live" /> Open source · MIT · we host nothing</div>
          <h1>
            Turn any PDF book into a<br />
            <span className="grad">living book website</span>
          </h1>
          <p className="sub">
            Booklith converts your PDF into a structured, AI-powered reading site — chat with the book,
            translate any paragraph into any language, listen along in 600+ languages, take quizzes —
            then export it to <strong>your</strong> GitHub and Vercel. Bring your own keys. We hold no secrets.
          </p>
          <div className="lp-cta">
            <a className="lp-btn primary" href="/build">Build your book →</a>
            <a className="lp-btn" href="#how">See how it works</a>
          </div>
          <div className="lp-note">No signup. No server. Works with the committed sample book right now.</div>
          <div className="lp-demos" aria-label="Sample book demos">
            <span>Try a reader:</span>
            <a href="/demo1">Sherlock Holmes</a>
            <a href="/demo2">Vinoba (Marathi)</a>
          </div>

          <div className="lp-mock" role="group" aria-label="Sample Booklith reader showing Sherlock Holmes and a cited answer">
            <div className="bar">
              <span className="window-controls" aria-hidden="true"><i /><i /><i /></span>
              <span className="url">The Adventures of Sherlock Holmes</span>
              <span className="reader-tools">Aa&nbsp;&nbsp;☾ Night&nbsp;&nbsp;✦ AI</span>
            </div>
            <div className="body">
              <aside className="side">
                <div className="book-meta">
                  <div className="book-cover" aria-hidden="true">S</div>
                  <div className="t">The Adventures of Sherlock Holmes</div>
                  <div className="author">Arthur Conan Doyle</div>
                </div>
                <div className="chapter-list">
                  <div className="chapter active">I. A Scandal in Bohemia</div>
                  <div className="chapter">II. The Red-Headed League</div>
                  <div className="chapter">III. A Case of Identity</div>
                </div>
              </aside>
              <article className="main">
                <div className="chapter-kicker">Chapter I · London</div>
                <h2 className="book-heading">A Scandal in Bohemia</h2>
                <p className="book-excerpt">
                  “To Sherlock Holmes she is always <em>the woman</em>. I have seldom heard him mention her
                  under any other name.”
                </p>
                <p className="book-continuation">
                  In his eyes she eclipses and predominates the whole of her sex.
                </p>
                <span className="cite">p-0002</span>
              </article>
              <aside className="ai">
                <div className="ai-heading"><span>✦ ASK THE BOOK</span><span className="online">●</span></div>
                <div className="bubble question">
                  <span className="role">YOU</span>
                  <p>Who is “the woman” Holmes never forgot?</p>
                </div>
                <div className="bubble answer">
                  <span className="role">ANSWER FROM THE BOOK</span>
                  <p><strong>Irene Adler.</strong> Watson says she eclipses all other women in Holmes’s eyes.</p>
                  <span className="cite">p-0002</span>
                </div>
              </aside>
            </div>
          </div>
        </header>

        <section className="lp-section" id="how">
          <h2>From PDF to website in four steps</h2>
          <p className="lead">Everything runs client-side or on infrastructure you own. Booklith is just the factory.</p>
          <div className="lp-steps">
            {STEPS.map((s) => (
              <div className="lp-step" key={s.n}>
                <div className="n">{s.n}</div>
                <h3>{s.h}</h3>
                <p>{s.p}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="lp-section" id="install">
          <h2>Set up optional OCR and speech</h2>
          <p className="lead">
            Deploy OCR and read-aloud services on your own Modal account. They scale to zero between requests
            and run only when you need them.
          </p>
          <div className="lp-setup-layout">
            <div className="lp-setup-info">
              <div className="lp-card">
                <div className="ico">🛰️</div>
                <h3>Services you control</h3>
                <p>
                  Deploy the included OCR and text-to-speech templates to your own account. They stay idle until
                  called.
                </p>
                <span className="tag">Modal · scales to zero</span>
              </div>
              <div className="lp-card">
                <div className="ico">📚</div>
                <h3>Or try a sample book</h3>
                <p>
                  Start without deploying anything: Sherlock Holmes and a Marathi book are included in the repo.
                </p>
                <span className="tag">No setup required</span>
              </div>
            </div>
            <div className="lp-card lp-commands">
              <div className="lp-commands-heading">
                <div>
                  <span className="lp-eyebrow">OPTIONAL SETUP</span>
                  <h3>Deploy your services</h3>
                </div>
                <span className="lp-command-count">2 steps</span>
              </div>
              <div className="lp-command-group">
                <h4><span>01</span> Install and sign in</h4>
                <pre className="lp-code"><code>{"pip install -U modal\nmodal setup"}</code></pre>
              </div>
              <div className="lp-command-group">
                <h4><span>02</span> Deploy OCR and speech</h4>
                <pre className="lp-code"><code>{"modal deploy modal/ocr2_modal.py\nmodal deploy modal/omnivoice_tts_modal.py"}</code></pre>
              </div>
              <p className="lp-command-note">Your service URLs are printed after deployment.</p>
            </div>
          </div>
        </section>

        <section className="lp-section" id="features">
          <h2>The exported reader is a real app</h2>
          <p className="lead">Not a static site: a full Next.js app with serverless API routes and your keys in env vars.</p>
          <div className="lp-bento">
            {[
              { ico: "🌐", title: "Any language, in and out", body: "AI translates any paragraph into any language on demand, and read-aloud TTS covers 600+ languages via OmniVoice — take a book in one language and make it truly universal.", tag: "translation + 600+ language TTS", wide: true },
              { ico: "💬", title: "AI chat, grounded in your book", body: "Pin paragraphs or whole chapters as top-priority context. Retrieval over the entire book backs every answer, and each claim cites a clickable paragraph id.", tag: "RAG + citations" },
              { ico: "🔊", title: "Read aloud", body: "Serverless TTS through your own Modal deployment — 600+ languages, any voice. The GPU scales to zero; your token never reaches the browser.", tag: "OmniVoice on Modal" },
              { ico: "📝", title: "AI-generated tests", body: "Practice quizzes for every chapter, written strictly from the text — every question cites its source paragraph.", tag: "grounded" },
              { ico: "🔗", title: "References you can trust", body: "The AI only writes search queries. URLs come from a live search API and are verified with real requests — never from model memory.", tag: "URL verification" },
              { ico: "📐", title: "Made for real books", body: "KaTeX math, markdown tables, figure placeholders, full-text search, themes and night mode — tuned on real OCR output, not pristine ebooks.", tag: "KaTeX + search" },
            ].map((f) => (
              <div className={`lp-card ${f.wide ? "wide" : ""}`} key={f.title}>
                <div className="ico">{f.ico}</div>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
                <span className="tag">{f.tag}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="lp-section" id="models">
          <h2>Powered by Meta&apos;s newest models</h2>
          <p className="lead">Meta models power the AI features; optional OCR and speech services run through Modal.</p>
          <div className="lp-bento">
            {[
              { ico: "🧠", title: "Muse Wonder", body: "Restructures OCR chaos into chapters. A reasoning model with a 1M-token window, tamed with reasoning_effort so it never burns your budget.", tag: "structure harness", wide: true },
              { ico: "⚡", title: "Muse Spark", body: "Chat answers with paragraph citations, translations into any language, quizzes and theme selection — fast, agent-ready, 1M-token context.", tag: "chat · translate · quiz" },
              { ico: "🎤", title: "Muse Voice Transcribe", body: "Ask the book a question out loud — speech is transcribed straight into the chat box, server-side, push-to-talk.", tag: "voice input" },
              { ico: "🛰️", title: "Search grounding", body: "References use Meta's web_search tool: URLs come from live search results with url_citation annotations, then get verified — never model memory.", tag: "web_search" },
            ].map((f) => (
              <div className={`lp-card ${f.wide ? "wide" : ""}`} key={f.title}>
                <div className="ico">{f.ico}</div>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
                <span className="tag">{f.tag}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="lp-section" id="privacy">
          <div className="lp-privacy">
            <div className="pt">
              <h3>🔒 We host nothing. We hold no secrets.</h3>
              <p>
                Your PDF goes from your browser to your own Modal OCR deployment. Your LLM key lives in your
                browser during the build and in your own Vercel project afterwards. Export runs client-side to
                your own GitHub repo. Booklith has no database, no accounts, no telemetry.
              </p>
            </div>
            <div className="chips">
              <span className="lp-chip">Browser → your Modal</span>
              <span className="lp-chip">Keys stay yours</span>
              <span className="lp-chip">One commit to your repo</span>
              <span className="lp-chip">Validator included</span>
              <span className="lp-chip">MIT licensed</span>
            </div>
          </div>
        </section>

        <section className="lp-final">
          <h2>Your book deserves a website.</h2>
          <p>Try it now with the committed sample book — zero setup, zero keys.</p>
          <a className="lp-btn primary" href="/build">Open Book Builder →</a>
        </section>

        <footer className="lp-footer">
          <span>Booklith · hackathon project · MIT</span>
          <span>OCR: Baidu Unlimited-OCR-2 on Modal · TTS: OmniVoice · App: Next.js</span>
        </footer>
      </div>
    </div>
  );
}
