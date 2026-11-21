import React, { useEffect, useRef, useState } from "react";

/* ------------------------------------------------------------------ */
/* Signature landing page                                              */
/* 60% Sky Blue #0593C6 · 30% White #FCFFFF · 10% Hot Pink #D83995      */
/* ------------------------------------------------------------------ */

const FALLBACK_ART = [
  { image_url: "https://images.unsplash.com/photo-1541961017774-22349e4a1262?w=900&q=80", title: "Colour Study", profiles: { name: "Signature" } },
  { image_url: "https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?w=700&q=80", title: "Abstract Weather", profiles: { name: "Signature" } },
  { image_url: "https://images.unsplash.com/photo-1578321272176-b7bbc0679853?w=700&q=80", title: "Studio Light", profiles: { name: "Signature" } },
];

const CATEGORY_WORDS = ["Illustration", "Photography", "Painting", "Sketch", "Digital", "Mixed media"];
const reducedMotion = () => typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------------- small interactive building blocks ---------------- */

function Reveal({ children, delay = 0, className = "", style, as: Tag = "div" }) {
  const ref = useRef(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (!("IntersectionObserver" in window) || reducedMotion()) { setOn(true); return undefined; }
    const io = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setOn(true); io.disconnect(); } }, { threshold: 0.12 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <Tag ref={ref} className={`ld-reveal${on ? " in" : ""} ${className}`} style={{ transitionDelay: `${delay}ms`, ...style }}>{children}</Tag>;
}

function Counter({ to, prefix = "", suffix = "" }) {
  const ref = useRef(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (!("IntersectionObserver" in window) || reducedMotion()) { setN(to); return undefined; }
    let raf;
    const io = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      io.disconnect();
      const start = performance.now();
      const tick = (t) => {
        const p = Math.min((t - start) / 1200, 1);
        setN(Math.round(to * (1 - Math.pow(1 - p, 3))));
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }, { threshold: 0.4 });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [to]);
  return <span ref={ref}>{prefix}{n}{suffix}</span>;
}

function Tilt({ children, max = 9, className = "", style }) {
  const ref = useRef(null);
  const move = (e) => {
    if (reducedMotion()) return;
    const r = ref.current.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    ref.current.style.transform = `rotateX(${(-y * max).toFixed(2)}deg) rotateY(${(x * max).toFixed(2)}deg) scale(1.035)`;
  };
  const leave = () => { if (ref.current) ref.current.style.transform = ""; };
  return <div ref={ref} className={`ld-tilt ${className}`} style={style} onMouseMove={move} onMouseLeave={leave}>{children}</div>;
}

function Magnetic({ children, strength = 0.28 }) {
  const ref = useRef(null);
  const move = (e) => {
    if (reducedMotion()) return;
    const r = ref.current.getBoundingClientRect();
    ref.current.style.transform = `translate(${((e.clientX - r.left - r.width / 2) * strength).toFixed(1)}px, ${((e.clientY - r.top - r.height / 2) * strength).toFixed(1)}px)`;
  };
  const leave = () => { if (ref.current) ref.current.style.transform = ""; };
  return <span ref={ref} className="ld-magnetic" onMouseMove={move} onMouseLeave={leave}>{children}</span>;
}

function Spot({ children, className = "", style }) {
  const ref = useRef(null);
  const move = (e) => {
    const r = ref.current.getBoundingClientRect();
    ref.current.style.setProperty("--sx", `${e.clientX - r.left}px`);
    ref.current.style.setProperty("--sy", `${e.clientY - r.top}px`);
  };
  return <div ref={ref} className={`ld-spot ${className}`} style={style} onMouseMove={move}>{children}</div>;
}

// Drag (or use the arrow keys) to compare a rough "before" with a refined "after".
function CompareSlider({ src, alt }) {
  const [pos, setPos] = useState(52);
  const box = useRef(null);
  const dragging = useRef(false);
  const setFrom = (clientX) => {
    const r = box.current.getBoundingClientRect();
    setPos(Math.max(2, Math.min(98, ((clientX - r.left) / r.width) * 100)));
  };
  return (
    <div
      ref={box}
      className="ld-compare"
      onPointerDown={(e) => { dragging.current = true; e.currentTarget.setPointerCapture?.(e.pointerId); setFrom(e.clientX); }}
      onPointerMove={(e) => dragging.current && setFrom(e.clientX)}
      onPointerUp={() => { dragging.current = false; }}
      onPointerCancel={() => { dragging.current = false; }}
    >
      <img src={src} alt={alt} draggable={false} className="ld-compare-img" />
      <img src={src} alt="" aria-hidden="true" draggable={false} className="ld-compare-img ld-compare-before" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }} />
      <span className="ld-compare-tag" style={{ left: 14 }}>BEFORE</span>
      <span className="ld-compare-tag after" style={{ right: 14 }}>AFTER</span>
      <div className="ld-compare-line" style={{ left: `${pos}%` }}>
        <span className="ld-compare-knob" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l-6 6 6 6M15 6l6 6-6 6" /></svg>
        </span>
      </div>
      <input
        type="range" min="2" max="98" value={Math.round(pos)} aria-label="Drag to compare the first version with the version after feedback"
        onChange={(e) => setPos(+e.target.value)} className="ld-compare-range"
      />
    </div>
  );
}

function Ico({ name, size = 18 }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" };
  const paths = {
    clock: <><circle cx="12" cy="12" r="9" {...p} /><path d="M12 7v5l3 2" {...p} /></>,
    expand: <><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" {...p} /></>,
    chat: <><path d="M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.2A8 8 0 1 1 21 12z" {...p} /></>,
    layers: <><path d="M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5" {...p} /></>,
    check: <><path d="M9 12l2 2 4-4" {...p} /><circle cx="12" cy="12" r="9" {...p} /></>,
    spark: <><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" {...p} /></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" {...p} /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

/* ---------------- the page ---------------- */

export default function LandingPage({ setPage, stats, works = [] }) {
  const rootRef = useRef(null);
  const heroRef = useRef(null);
  const [scrolled, setScrolled] = useState(false);
  const [progress, setProgress] = useState(0);

  // Real works first (so visitors see the actual community); sample art fills any gaps.
  const real = works.filter((w) => w.image_url).slice(0, 6);
  const showcase = [...real, ...FALLBACK_ART.filter((_, i) => i >= real.length - 0)].slice(0, 6);
  while (showcase.length < 6) showcase.push(FALLBACK_ART[showcase.length % FALLBACK_ART.length]);
  const [a, b, c] = showcase;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const onScroll = () => {
      setScrolled(root.scrollTop > 24);
      const max = root.scrollHeight - root.clientHeight;
      setProgress(max > 0 ? root.scrollTop / max : 0);
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => root.removeEventListener("scroll", onScroll);
  }, []);

  // Mouse parallax: only writes two CSS variables, so React never re-renders while the mouse moves.
  const onHeroMove = (e) => {
    if (reducedMotion() || !heroRef.current) return;
    const r = heroRef.current.getBoundingClientRect();
    heroRef.current.style.setProperty("--mx", (((e.clientX - r.left) / r.width) * 2 - 1).toFixed(3));
    heroRef.current.style.setProperty("--my", (((e.clientY - r.top) / r.height) * 2 - 1).toFixed(3));
  };

  const go = (id) => {
    const root = rootRef.current;
    const el = root?.querySelector(`#${id}`);
    if (root && el) root.scrollTo({ top: el.offsetTop - 70, behavior: reducedMotion() ? "auto" : "smooth" });
  };

  const words = ["Where", "artists", "become", "known", "by", "their"];

  return (
    <div className="ld sig-scrollbar" ref={rootRef}>
      <style>{LANDING_CSS}</style>
      <div className="ld-progress" style={{ transform: `scaleX(${progress})` }} />

      {/* ---------- floating nav ---------- */}
      <header className={`ld-nav${scrolled ? " scrolled" : ""}`}>
        <button className="ld-logo" onClick={() => rootRef.current?.scrollTo({ top: 0, behavior: "smooth" })} aria-label="Signature, back to top">
          <span className="ld-logo-mark" aria-hidden="true">
            <svg width="38" height="38" viewBox="0 0 32 32"><path d="M8.5 21.5c3-8.5 6.2-11.8 8.2-9.8s-3.2 8.4-1 9.4 5-4 7.8-6.4" stroke="#fff" strokeWidth="2.3" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
          <span className="ld-logo-text">Signature</span>
        </button>
        <nav className="ld-links" aria-label="Sections">
          <button onClick={() => go("gallery")}>Gallery</button>
          <button onClick={() => go("craft")}>The craft</button>
          <button onClick={() => go("growth")}>Growth</button>
          <button onClick={() => go("manifesto")}>Manifesto</button>
        </nav>
        <div className="ld-nav-cta">
          <button className="ld-signin" onClick={() => setPage("signin")}>Sign in</button>
          <button className="sig-btn-primary" onClick={() => setPage("signup")}>Get started</button>
        </div>
      </header>

      {/* ---------- hero ---------- */}
      <section className="ld-hero" ref={heroRef} onMouseMove={onHeroMove}>
        <div className="ld-orb cyan" aria-hidden="true" />
        <div className="ld-orb pink" aria-hidden="true" />
        <div className="ld-orb deep" aria-hidden="true" />
        <div className="ld-stripes" aria-hidden="true" />
        <div className="ld-grain" aria-hidden="true" />

        <div className="ld-hero-grid">
          <div className="ld-hero-copy">
            <div className="ld-chip ld-rise" style={{ animationDelay: "60ms" }}>
              <span className="ld-dot" /> A free gallery for illustrators, photographers &amp; painters
            </div>
            <h1 className="ld-h1" aria-label="Where artists become known by their signature.">
              {words.map((w, i) => (
                <span className="ld-word" key={w} aria-hidden="true"><span style={{ animationDelay: `${180 + i * 85}ms` }}>{w}&nbsp;</span></span>
              ))}
              <span className="ld-word ld-sig" aria-hidden="true">
                <span style={{ animationDelay: `${180 + words.length * 85}ms` }}>
                  <em className="sig-accent">signature.</em>
                  <svg className="ld-squiggle" viewBox="0 0 300 18" preserveAspectRatio="none" aria-hidden="true"><path d="M3 12C28 2 46 16 74 8s44 8 72 0 44 8 72 0 44 6 79 -1" /></svg>
                </span>
              </span>
            </h1>
            <p className="ld-sub ld-rise" style={{ animationDelay: "900ms" }}>
              A quiet, high-fidelity home for your work: chronological feeds, full-resolution uploads, and honest critique that actually makes the next piece better.
            </p>
            <div className="ld-cta-row ld-rise" style={{ animationDelay: "1050ms" }}>
              <Magnetic><button className="sig-btn-primary ld-big" onClick={() => setPage("signup")}>Start your portfolio <Ico name="arrow" size={16} /></button></Magnetic>
              <Magnetic><button className="ld-glass-btn" onClick={() => setPage("explore")}>Wander the gallery</button></Magnetic>
            </div>
            <div className="ld-mini ld-rise" style={{ animationDelay: "1200ms" }}>
              <span>No ads</span><i /><span>No algorithm</span><i /><span>Free forever</span>
            </div>
          </div>

          <div className="ld-stage" aria-hidden="true">
            <div className="ld-px" style={{ "--d": "26px", left: "19%", top: "3%", width: "50%", zIndex: 2 }}>
              <div className="ld-float" style={{ animationDelay: "0s" }}>
                <Tilt className="ld-art" style={{ aspectRatio: "4 / 5", transform: undefined }}>
                  <img src={a.image_url} alt="" loading="eager" />
                  <div className="ld-label"><b>{a.title}</b><span>{a.profiles?.name || "Signature"}</span></div>
                  <span className="ld-pill pink">CRITIQUE REQUESTED</span>
                </Tilt>
              </div>
            </div>
            <div className="ld-px" style={{ "--d": "46px", left: "0%", bottom: "2%", width: "33%", zIndex: 3 }}>
              <div className="ld-float" style={{ animationDelay: "-2.4s" }}>
                <Tilt className="ld-art" style={{ aspectRatio: "1 / 1" }}>
                  <img src={b.image_url} alt="" loading="eager" />
                  <div className="ld-label"><b>{b.title}</b><span>{b.profiles?.name || "Signature"}</span></div>
                  <span className="ld-pill white">PROCESS · 3 STEPS</span>
                </Tilt>
              </div>
            </div>
            <div className="ld-px" style={{ "--d": "-18px", right: "0%", top: "10%", width: "29%", zIndex: 1 }}>
              <div className="ld-float" style={{ animationDelay: "-4.2s" }}>
                <Tilt className="ld-art" style={{ aspectRatio: "3 / 4" }}>
                  <img src={c.image_url} alt="" loading="eager" />
                  <div className="ld-label"><b>{c.title}</b><span>{c.profiles?.name || "Signature"}</span></div>
                </Tilt>
              </div>
            </div>
            <div className="ld-px" style={{ "--d": "34px", right: "0%", bottom: "0%", width: "46%", zIndex: 4 }}>
              <div className="ld-float" style={{ animationDelay: "-1.2s" }}>
                <div className="ld-glass-card">
                  <div className="ld-glass-title">LIVE IN THE GALLERY</div>
                  <div className="ld-stats">
                    <div><strong><Counter to={stats?.works || 0} /></strong><span>works</span></div>
                    <div><strong><Counter to={stats?.creators || 0} /></strong><span>artists</span></div>
                    <div><strong><Counter to={0} prefix="$" /></strong><span>forever</span></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="ld-strip ld-rise" style={{ animationDelay: "1350ms" }}>
          {[["clock", "Chronological feed", "Not an algorithm"], ["expand", "Full resolution", "Originals stay intact"], ["chat", "Honest critique", "That helps the next piece"], ["layers", "Process shots", "Show how it was made"], ["check", "Verified artists", "Human-reviewed badge"]].map(([icon, t, s]) => (
            <div className="ld-strip-item" key={t}>
              <span className="ld-strip-ico"><Ico name={icon} /></span>
              <span><b>{t}</b><small>{s}</small></span>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- marquee ---------- */}
      <section className="ld-marquee" aria-label="Categories">
        <div className="ld-marquee-track">
          {[0, 1].map((k) => (
            <div className="ld-marquee-half" key={k} aria-hidden={k === 1}>
              {CATEGORY_WORDS.map((w) => (<span key={w + k}>{w}<em>✦</em></span>))}
            </div>
          ))}
        </div>
      </section>

      {/* ---------- live gallery ---------- */}
      <section className="ld-section ld-blue" id="gallery">
        <Reveal><div className="ld-chip solid">LIVE FROM THE GALLERY</div></Reveal>
        <Reveal delay={80}><h2 className="ld-h2">Fresh work, in the order it was made.</h2></Reveal>
        <div className="ld-showcase">
          {showcase.map((w, i) => (
            <Reveal key={(w.id || w.image_url) + i} delay={i * 70} className="ld-show-item">
              <button className="ld-show" onClick={() => setPage("explore")} aria-label={`${w.title} — open the gallery`}>
                <img src={w.image_url} alt={w.title} loading="lazy" />
                <span className="ld-show-info"><b>{w.title}</b><small>{w.profiles?.name || "Signature"}</small></span>
              </button>
            </Reveal>
          ))}
        </div>
        <Reveal delay={120}>
          <div style={{ textAlign: "center", marginTop: 36 }}>
            <Magnetic><button className="sig-btn-primary ld-big" onClick={() => setPage("explore")}>See everything <Ico name="arrow" size={16} /></button></Magnetic>
          </div>
        </Reveal>
      </section>

      {/* ---------- the craft (bento) ---------- */}
      <section className="ld-section ld-white" id="craft">
        <Reveal><div className="ld-chip tint">THE CRAFT</div></Reveal>
        <Reveal delay={80}><h2 className="ld-h2 dark">Everything an artist actually needs. <span className="sig-accent" style={{ color: "var(--pink)" }}>Nothing</span> they don't.</h2></Reveal>
        <div className="ld-bento">
          <Reveal className="b1"><Spot className="ld-card">
            <div className="ld-card-kicker pink">CRITIQUE REQUESTED</div>
            <h3>Ask for the feedback you want.</h3>
            <p>Flag a piece and the conversation changes: structured, honest critique instead of a pile of empty likes. Download it all as a tidy summary.</p>
            <div className="ld-mock">
              <div className="ld-bubble"><i style={{ background: "var(--sky)" }} /><div><b>Mira</b> <em>CRITIQUE</em><br />The warm light is lovely — the left edge feels unresolved.</div></div>
              <div className="ld-bubble"><i style={{ background: "var(--pink)" }} /><div><b>Dev</b> <em>CRITIQUE</em><br />Try pushing contrast around the focal point.</div></div>
            </div>
          </Spot></Reveal>
          <Reveal className="b2" delay={90}><Spot className="ld-card">
            <div className="ld-card-kicker">GROWTH THREADS</div>
            <h3>Show the feedback that worked.</h3>
            <p>Link a new piece to the earlier one it improves on, and the critique that shaped it.</p>
            <div className="ld-thread">
              <span style={{ background: "linear-gradient(135deg,#9bb7c4,#cfdde4)" }}>v1</span>
              <svg width="26" height="14" viewBox="0 0 26 14" fill="none" stroke="var(--pink)" strokeWidth="2.4" strokeLinecap="round"><path d="M1 7h22M17 2l6 5-6 5" /></svg>
              <span style={{ background: "linear-gradient(135deg,#0593C6,#D83995)", color: "#fff" }}>v2</span>
            </div>
          </Spot></Reveal>
          <Reveal className="b3" delay={60}><Spot className="ld-card">
            <div className="ld-card-kicker">STUDIO LOG</div>
            <h3>Show the process.</h3>
            <p>Sketch, linework, colour, final — a swipeable sequence, in full resolution.</p>
            <div className="ld-stack"><i /><i /><i /><i /></div>
          </Spot></Reveal>
          <Reveal className="b4" delay={140}><Spot className="ld-card">
            <div className="ld-card-kicker">AI FIRST PASS · OPTIONAL</div>
            <h3>A starting point, not a verdict.</h3>
            <p>Ask for a quick AI read on composition, colour, technique and emotional impact. Clearly labelled, never a score, always before the people weigh in.</p>
            <div className="ld-axes"><span>Composition</span><span>Colour</span><span>Technique</span><span>Emotional impact</span></div>
          </Spot></Reveal>
          <Reveal className="b5" delay={220}><Spot className="ld-card">
            <div className="ld-card-kicker">NO ALGORITHM</div>
            <h3>Chronological, always.</h3>
            <p>Follow artists and tags. See what was actually just made.</p>
            <div className="ld-times"><span>just now</span><span>2h ago</span><span>yesterday</span></div>
          </Spot></Reveal>
        </div>
      </section>

      {/* ---------- growth / compare ---------- */}
      <section className="ld-section ld-blue" id="growth">
        <div className="ld-split">
          <div>
            <Reveal><div className="ld-chip solid">GROWTH THREADS</div></Reveal>
            <Reveal delay={80}><h2 className="ld-h2">From rough to refined — and <span className="sig-accent">why.</span></h2></Reveal>
            <Reveal delay={140}><p className="ld-lead">Drag the handle. This is the idea behind Growth Threads: your earlier piece, the feedback it got, and what you changed because of it, all in one place for the next person who wants to learn from it.</p></Reveal>
            <Reveal delay={200}>
              <ol className="ld-steps">
                <li><b>Publish</b> a piece and tick “Critique requested”.</li>
                <li><b>Collect</b> honest, structured feedback.</li>
                <li><b>Link</b> your next piece to it and show what changed.</li>
              </ol>
            </Reveal>
          </div>
          <Reveal delay={120}><CompareSlider src={showcase[3].image_url} alt={`${showcase[3].title}, drag to compare before and after`} /></Reveal>
        </div>
      </section>

      {/* ---------- manifesto ---------- */}
      <section className="ld-section ld-white" id="manifesto">
        <Reveal><div className="ld-chip tint">MANIFESTO</div></Reveal>
        <Reveal delay={80}><h2 className="ld-mega">Made for artists,<br />not for <span className="ld-hl">advertisers.</span></h2></Reveal>
        <div className="ld-pillars">
          {[["No ads", "Nobody pays to be seen. Nothing is for sale."], ["No algorithm", "The feed is the order the work was made."], ["No clipped pixels", "You keep your originals, your voice and your audience."]].map(([t, s], i) => (
            <Reveal key={t} delay={i * 90}><Spot className="ld-card slim"><h3>{t}</h3><p>{s}</p></Spot></Reveal>
          ))}
        </div>
      </section>

      {/* ---------- final call ---------- */}
      <section className="ld-final">
        <div className="ld-orb pink small" aria-hidden="true" />
        <div className="ld-orb cyan small" aria-hidden="true" />
        <div className="ld-stripes" aria-hidden="true" />
        <Reveal><h2 className="ld-mega light">Sign your first piece today.</h2></Reveal>
        <Reveal delay={100}><p className="ld-lead center">Free forever. No credit card. Just your work, and people who care about it.</p></Reveal>
        <Reveal delay={180}>
          <div className="ld-cta-row center">
            <Magnetic><button className="sig-btn-primary ld-big" onClick={() => setPage("signup")}>Create your account <Ico name="arrow" size={16} /></button></Magnetic>
            <Magnetic><button className="ld-glass-btn" onClick={() => setPage("signin")}>I already have one</button></Magnetic>
          </div>
        </Reveal>
      </section>

      <footer className="ld-footer">
        <span className="ld-footer-logo">Signature</span>
        <div className="ld-footer-links">
          <button onClick={() => setPage("explore")}>Gallery</button>
          <button onClick={() => setPage("privacy")}>Privacy</button>
          <button onClick={() => setPage("terms")}>Terms</button>
          <span>© 2026 · Free forever · Made with care</span>
        </div>
      </footer>
    </div>
  );
}

/* ---------------- styles (scoped with the ld- prefix) ---------------- */

const LANDING_CSS = `
.ld { height: 100vh; overflow-y: auto; overflow-x: hidden; background: var(--white); color: var(--ink); position: relative; }
.ld button { font-family: inherit; }
.ld-progress { position: fixed; top: 0; left: 0; right: 0; height: 3px; background: var(--pink); transform-origin: 0 50%; transform: scaleX(0); z-index: 60; }

/* nav */
.ld-nav { position: sticky; top: 14px; z-index: 50; margin: 14px auto 0; max-width: 1280px; width: calc(100% - 32px); display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 9px 12px 9px 14px; border-radius: 999px; transition: background .3s ease, box-shadow .3s ease, backdrop-filter .3s ease; color: #fff; }
.ld-nav.scrolled { background: rgba(252,255,255,0.86); -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px); box-shadow: 0 12px 36px rgba(2,60,86,0.25); color: var(--ink); }
.ld-logo { display: inline-flex; align-items: center; gap: 10px; background: none; border: 0; cursor: pointer; color: inherit; padding: 0; }
.ld-logo-mark { width: 38px; height: 38px; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #0593C6, #D83995); box-shadow: 0 6px 16px rgba(2,60,86,0.3); }
.ld-logo-text { font-weight: 700; font-size: 19px; letter-spacing: -0.02em; }
.ld-links { display: flex; gap: 2px; padding: 4px; border-radius: 999px; background: rgba(255,255,255,0.16); border: 1px solid rgba(255,255,255,0.3); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); }
.ld-nav.scrolled .ld-links { background: var(--sky-100); border-color: var(--border); }
.ld-links button { background: none; border: 0; color: inherit; font-size: 13.5px; font-weight: 600; padding: 8px 15px; border-radius: 999px; cursor: pointer; transition: background .2s ease; }
.ld-links button:hover { background: rgba(255,255,255,0.28); }
.ld-nav.scrolled .ld-links button:hover { background: #fff; color: var(--sky-700); }
.ld-nav-cta { display: flex; align-items: center; gap: 8px; }
.ld-signin { background: none; border: 0; color: inherit; font-weight: 700; font-size: 14px; padding: 10px 14px; cursor: pointer; border-radius: 999px; }
.ld-signin:hover { background: rgba(255,255,255,0.2); }
.ld-nav.scrolled .ld-signin:hover { background: var(--sky-100); }

/* hero */
.ld-hero { --mx: 0; --my: 0; position: relative; margin-top: -76px; padding-top: 76px; min-height: 100vh; display: flex; flex-direction: column; justify-content: space-between; color: #fff; overflow: hidden;
  background: linear-gradient(165deg, #0aa2d8 0%, #0593C6 48%, #047FAB 100%); }
.ld-orb { position: absolute; border-radius: 50%; filter: blur(70px); pointer-events: none; will-change: transform; }
.ld-orb.cyan { width: 52vw; height: 52vw; left: -16vw; top: -18vw; background: #5CC3E6; opacity: .75; animation: ldDrift 19s ease-in-out infinite alternate; }
.ld-orb.pink { width: 46vw; height: 46vw; right: -12vw; bottom: -16vw; background: #D83995; opacity: .42; animation: ldDrift 23s ease-in-out -6s infinite alternate-reverse; }
.ld-orb.deep { width: 40vw; height: 40vw; left: 30vw; bottom: -22vw; background: #036A91; opacity: .6; animation: ldDrift 27s ease-in-out -11s infinite alternate; }
.ld-orb.small { width: 36vw; height: 36vw; }
@keyframes ldDrift { from { transform: translate3d(0,0,0) scale(1); } to { transform: translate3d(5vw, 4vw, 0) scale(1.14); } }
.ld-stripes { position: absolute; inset: 0; pointer-events: none; background: repeating-linear-gradient(90deg, rgba(255,255,255,0.06) 0 1px, transparent 1px 11px);
  -webkit-mask-image: radial-gradient(ellipse at 62% 48%, #000 0%, transparent 78%); mask-image: radial-gradient(ellipse at 62% 48%, #000 0%, transparent 78%); }
.ld-grain { position: absolute; inset: 0; pointer-events: none; opacity: .22; mix-blend-mode: overlay;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>"); }
.ld-hero-grid { position: relative; z-index: 2; display: grid; grid-template-columns: 1.08fr 0.92fr; gap: 30px; align-items: center; width: 100%; max-width: 1360px; margin: 0 auto; padding: 36px 40px 18px; }
.ld-chip { display: inline-flex; align-items: center; gap: 9px; font-size: 12px; font-weight: 700; letter-spacing: 0.06em; padding: 8px 15px; border-radius: 999px; background: rgba(3,70,100,0.34); border: 1px solid rgba(255,255,255,0.3); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); color: #fff; }
.ld-chip.solid { background: #fff; color: var(--sky-700); border-color: transparent; box-shadow: 0 6px 18px rgba(2,60,86,0.2); }
.ld-chip.tint { background: var(--sky-100); color: var(--sky-700); border-color: var(--border); }
.ld-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--pink); box-shadow: 0 0 0 4px rgba(216,57,149,0.35); animation: ldPulse 2.4s ease-in-out infinite; }
@keyframes ldPulse { 50% { box-shadow: 0 0 0 8px rgba(216,57,149,0); } }
.ld-h1 { font-size: clamp(44px, 6.5vw, 100px); line-height: 0.98; font-weight: 500; letter-spacing: -0.045em; margin: 22px 0 22px; text-shadow: 0 4px 30px rgba(3,70,100,0.28); }
.ld-word { display: inline-block; overflow: hidden; vertical-align: top; padding: 0 0 0.14em; margin-bottom: -0.14em; }
.ld-word > span { display: inline-block; transform: translateY(112%); animation: ldRise 1s cubic-bezier(.2,.8,.2,1) forwards; position: relative; }
.ld-sig .sig-accent { font-weight: 400; font-size: 1.04em; letter-spacing: -0.01em; }
.ld-squiggle { position: absolute; left: 2%; right: 2%; bottom: -0.04em; width: 96%; height: 0.2em; overflow: visible; }
.ld-squiggle path { fill: none; stroke: var(--pink); stroke-width: 5; stroke-linecap: round; stroke-dasharray: 420; stroke-dashoffset: 420; animation: ldDraw 1.1s ease 1.7s forwards; filter: drop-shadow(0 2px 6px rgba(216,57,149,0.45)); }
@keyframes ldDraw { to { stroke-dashoffset: 0; } }
@keyframes ldRise { to { transform: translateY(0); } }
.ld-rise { opacity: 0; transform: translateY(18px); animation: ldFade .9s cubic-bezier(.2,.8,.2,1) forwards; }
@keyframes ldFade { to { opacity: 1; transform: none; } }
.ld-sub { font-size: clamp(15px, 1.35vw, 19px); line-height: 1.65; max-width: 540px; color: rgba(255,255,255,0.96); margin: 0 0 30px; }
.ld-cta-row { display: flex; gap: 14px; flex-wrap: wrap; align-items: center; margin-bottom: 26px; }
.ld-cta-row.center { justify-content: center; }
.ld-big { font-size: 15px !important; padding: 15px 28px !important; display: inline-flex; align-items: center; gap: 10px; }
.ld-glass-btn { background: rgba(255,255,255,0.18); color: #fff; border: 1px solid rgba(255,255,255,0.55); border-radius: 999px; padding: 14px 26px; font-size: 15px; font-weight: 700; cursor: pointer; -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); transition: background .2s ease, color .2s ease; }
.ld-glass-btn:hover { background: #fff; color: var(--sky-700); }
.ld-magnetic { display: inline-block; transition: transform .25s cubic-bezier(.2,.8,.2,1); }
.ld-mini { display: flex; align-items: center; gap: 12px; font-size: 13px; font-weight: 700; letter-spacing: 0.04em; color: #fff; }
.ld-mini i { width: 4px; height: 4px; border-radius: 50%; background: #fff; opacity: .7; }

/* hero stage */
.ld-stage { position: relative; height: min(640px, 70vh); perspective: 1300px; }
.ld-px { position: absolute; transform: translate3d(calc(var(--mx) * var(--d)), calc(var(--my) * var(--d)), 0); transition: transform .35s ease-out; }
.ld-float { animation: ldBob 9s ease-in-out infinite; }
@keyframes ldBob { 50% { transform: translateY(-14px); } }
.ld-tilt { transition: transform .3s cubic-bezier(.2,.8,.2,1); transform-style: preserve-3d; will-change: transform; }
.ld-art { position: relative; border-radius: 26px; overflow: hidden; background: var(--sky-100); border: 5px solid #FCFFFF; box-shadow: 0 30px 60px rgba(2,50,74,0.4); }
.ld-art img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ld-label { position: absolute; left: 10px; right: 10px; bottom: 10px; padding: 9px 12px; border-radius: 16px; background: linear-gradient(transparent, rgba(3,40,58,0.55)), rgba(3,60,86,0.45); border: 1px solid rgba(255,255,255,0.35); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); display: flex; flex-direction: column; color: #fff; }
.ld-label b { font-size: 13px; font-weight: 700; } .ld-label span { font-size: 11px; opacity: .92; }
.ld-pill { position: absolute; top: 12px; left: 12px; font-size: 9.5px; font-weight: 800; letter-spacing: 0.07em; padding: 5px 10px; border-radius: 999px; }
.ld-pill.pink { background: var(--pink); color: #fff; box-shadow: 0 6px 14px rgba(216,57,149,0.5); }
.ld-pill.white { background: #fff; color: var(--sky-700); }
.ld-glass-card { padding: 16px 18px; border-radius: 22px; background: rgba(3,70,100,0.42); border: 1px solid rgba(255,255,255,0.4); -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px); box-shadow: 0 24px 50px rgba(2,50,74,0.35); color: #fff; }
.ld-glass-title { font-size: 10px; font-weight: 800; letter-spacing: 0.14em; margin-bottom: 10px; }
.ld-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.ld-stats strong { display: block; font-size: clamp(22px, 2.4vw, 32px); font-weight: 600; letter-spacing: -0.03em; line-height: 1; }
.ld-stats > div > span { font-size: 11px; opacity: .92; }

/* feature strip */
.ld-strip { position: relative; z-index: 2; max-width: 1360px; width: calc(100% - 80px); margin: 0 auto 28px; display: grid; grid-template-columns: repeat(5, 1fr); gap: 0; border-radius: 22px; background: rgba(3,70,100,0.34); border: 1px solid rgba(255,255,255,0.32); -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); overflow: hidden; }
.ld-strip-item { display: flex; align-items: center; gap: 12px; padding: 16px 18px; color: #fff; border-right: 1px solid rgba(255,255,255,0.2); transition: background .2s ease; }
.ld-strip-item:last-child { border-right: 0; } .ld-strip-item:hover { background: rgba(255,255,255,0.1); }
.ld-strip-ico { width: 38px; height: 38px; border-radius: 12px; background: rgba(255,255,255,0.2); display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
.ld-strip-item b { display: block; font-size: 13px; font-weight: 700; } .ld-strip-item small { display: block; font-size: 11.5px; opacity: .92; margin-top: 1px; }

/* marquee */
.ld-marquee { background: var(--white); overflow: hidden; padding: 30px 0; border-bottom: 1px solid var(--border); }
.ld-marquee-track { display: flex; width: max-content; animation: ldMarquee 34s linear infinite; }
.ld-marquee:hover .ld-marquee-track { animation-play-state: paused; }
.ld-marquee-half { display: flex; align-items: center; }
.ld-marquee-half span { font-size: clamp(36px, 6vw, 84px); font-weight: 700; letter-spacing: -0.04em; color: var(--sky); padding: 0 6px 0 22px; white-space: nowrap; display: inline-flex; align-items: center; gap: 28px; transition: color .25s ease; }
.ld-marquee-half span:hover { color: var(--pink); }
.ld-marquee-half em { font-style: normal; color: var(--pink); font-size: .5em; }
@keyframes ldMarquee { to { transform: translateX(-50%); } }

/* sections */
.ld-section { padding: 96px 48px; position: relative; }
.ld-section > * { max-width: 1280px; margin-left: auto; margin-right: auto; }
.ld-blue { background: linear-gradient(170deg, #0aa2d8, #0593C6 55%, #047FAB); color: #fff; }
.ld-white { background: var(--white); color: var(--ink); }
.ld-h2 { font-size: clamp(32px, 4.6vw, 64px); font-weight: 600; letter-spacing: -0.04em; line-height: 1.04; margin: 18px auto 44px; max-width: 1280px; text-shadow: 0 2px 18px rgba(3,70,100,0.22); }
.ld-h2.dark { color: var(--ink); text-shadow: none; }
.ld-h2 .sig-accent { color: #fff; }
.ld-mega { font-size: clamp(40px, 7vw, 104px); font-weight: 600; letter-spacing: -0.05em; line-height: 0.98; margin: 18px auto 40px; }
.ld-mega.light { color: #fff; text-align: center; text-shadow: 0 4px 30px rgba(3,70,100,0.3); }
.ld-hl { background: linear-gradient(transparent 62%, rgba(216,57,149,0.28) 62%); color: var(--pink-600); padding: 0 .06em; }
.ld-lead { font-size: clamp(15px, 1.3vw, 18px); line-height: 1.7; max-width: 560px; color: rgba(255,255,255,0.96); margin: 0 0 24px; }
.ld-lead.center { text-align: center; margin: 0 auto 32px; }

/* reveal on scroll */
.ld-reveal { opacity: 0; transform: translateY(34px); transition: opacity .8s cubic-bezier(.2,.8,.2,1), transform .8s cubic-bezier(.2,.8,.2,1); }
.ld-reveal.in { opacity: 1; transform: none; }

/* showcase */
.ld-showcase { column-count: 3; column-gap: 18px; }
.ld-show-item { break-inside: avoid; margin-bottom: 18px; display: inline-block; width: 100%; }
.ld-show { position: relative; display: block; width: 100%; padding: 6px; border: 0; border-radius: 26px; background: var(--white); cursor: pointer; box-shadow: 0 14px 34px rgba(2,60,86,0.3); transition: transform .35s cubic-bezier(.2,.8,.2,1), box-shadow .35s ease; overflow: hidden; }
.ld-show img { display: block; width: 100%; border-radius: 20px; transition: transform .8s cubic-bezier(.2,.8,.2,1); }
.ld-show:hover { transform: translateY(-8px) rotate(-0.6deg); box-shadow: 0 30px 56px rgba(2,50,74,0.42); }
.ld-show:hover img { transform: scale(1.05); }
.ld-show-info { position: absolute; left: 6px; right: 6px; bottom: 6px; padding: 38px 16px 14px; border-radius: 0 0 20px 20px; background: linear-gradient(transparent, rgba(3,40,58,0.88)); color: #fff; text-align: left; display: flex; flex-direction: column; opacity: 0; transform: translateY(10px); transition: opacity .3s ease, transform .3s ease; }
.ld-show:hover .ld-show-info, .ld-show:focus-visible .ld-show-info { opacity: 1; transform: none; }
@media (hover: none) { .ld-show-info { opacity: 1; transform: none; } }
.ld-show-info b { font-size: 15px; } .ld-show-info small { font-size: 12px; opacity: .92; }

/* bento */
.ld-bento { display: grid; grid-template-columns: repeat(6, 1fr); gap: 18px; }
.ld-bento .b1 { grid-column: span 4; } .ld-bento .b2 { grid-column: span 2; }
.ld-bento .b3, .ld-bento .b4, .ld-bento .b5 { grid-column: span 2; }
.ld-bento .b4 { grid-column: span 2; }
.ld-bento > div { display: flex; } .ld-bento > div > .ld-card { width: 100%; }
.ld-card { --sx: 50%; --sy: 50%; position: relative; overflow: hidden; border-radius: 28px; padding: 30px; background: #fff; border: 1px solid var(--border); box-shadow: 0 10px 30px rgba(3,70,100,0.1); transition: transform .3s cubic-bezier(.2,.8,.2,1), box-shadow .3s ease, border-color .3s ease; }
.ld-card::before { content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; opacity: 0; transition: opacity .3s ease; background: radial-gradient(380px circle at var(--sx) var(--sy), rgba(5,147,198,0.17), rgba(216,57,149,0.07) 45%, transparent 70%); }
.ld-card:hover { transform: translateY(-6px); border-color: var(--border-strong); box-shadow: 0 26px 50px rgba(3,70,100,0.2); }
.ld-card:hover::before { opacity: 1; }
.ld-card > * { position: relative; }
.ld-card h3 { font-size: clamp(20px, 2vw, 27px); font-weight: 600; letter-spacing: -0.03em; line-height: 1.12; margin: 10px 0 10px; color: var(--ink); }
.ld-card p { font-size: 14.5px; line-height: 1.65; color: var(--fg-2); margin: 0; }
.ld-card.slim { padding: 26px; }
.ld-card-kicker { font-size: 11px; font-weight: 800; letter-spacing: 0.12em; color: var(--sky-700); }
.ld-card-kicker.pink { color: var(--pink-600); }
.ld-mock { margin-top: 22px; display: grid; gap: 10px; }
.ld-bubble { display: flex; gap: 12px; align-items: flex-start; padding: 12px 14px; border-radius: 18px; background: var(--sky-100); font-size: 13px; line-height: 1.5; color: var(--ink); }
.ld-bubble i { width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0; }
.ld-bubble em { font-style: normal; font-size: 9.5px; font-weight: 800; letter-spacing: 0.07em; color: var(--pink-600); background: var(--pink-100); padding: 2px 7px; border-radius: 999px; margin-left: 4px; }
.ld-thread { display: flex; align-items: center; gap: 12px; margin-top: 22px; }
.ld-thread span { width: 64px; height: 64px; border-radius: 18px; display: inline-flex; align-items: center; justify-content: center; font-weight: 800; color: var(--sky-700); }
.ld-stack { position: relative; height: 84px; margin-top: 20px; }
.ld-stack i { position: absolute; top: 0; width: 74px; height: 74px; border-radius: 16px; border: 3px solid #fff; box-shadow: 0 8px 18px rgba(3,70,100,0.25); }
.ld-stack i:nth-child(1) { left: 0; background: linear-gradient(135deg,#cfe9f4,#9bd2ea); transform: rotate(-6deg); }
.ld-stack i:nth-child(2) { left: 34px; background: linear-gradient(135deg,#9bd2ea,#5CC3E6); transform: rotate(-2deg); }
.ld-stack i:nth-child(3) { left: 68px; background: linear-gradient(135deg,#5CC3E6,#0593C6); transform: rotate(3deg); }
.ld-stack i:nth-child(4) { left: 102px; background: linear-gradient(135deg,#0593C6,#D83995); transform: rotate(7deg); }
.ld-card:hover .ld-stack i { transform: translateY(-6px) rotate(0); transition: transform .4s ease; }
.ld-axes, .ld-times { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; }
.ld-axes span, .ld-times span { font-size: 12px; font-weight: 700; padding: 6px 12px; border-radius: 999px; background: var(--sky-100); color: var(--sky-700); }
.ld-axes span:nth-child(odd) { background: var(--pink-100); color: var(--pink-600); }

/* compare */
.ld-split { display: grid; grid-template-columns: 0.9fr 1.1fr; gap: 56px; align-items: center; }
.ld-split .ld-h2 { margin-bottom: 20px; }
.ld-steps { margin: 0; padding: 0; list-style: none; counter-reset: s; display: grid; gap: 12px; }
.ld-steps li { counter-increment: s; display: flex; gap: 14px; align-items: center; font-size: 15px; background: rgba(3,70,100,0.34); border: 1px solid rgba(255,255,255,0.3); border-radius: 18px; padding: 14px 18px; color: #fff; }
.ld-steps li::before { content: counter(s); width: 30px; height: 30px; border-radius: 50%; background: var(--pink); color: #fff; font-weight: 800; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
.ld-compare { position: relative; border-radius: 30px; overflow: hidden; border: 6px solid #FCFFFF; box-shadow: 0 34px 70px rgba(2,50,74,0.42); cursor: ew-resize; touch-action: pan-y; user-select: none; background: var(--sky-100); aspect-ratio: 4 / 3; }
.ld-compare-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; filter: saturate(1.25) contrast(1.06); }
.ld-compare-before { filter: grayscale(0.85) contrast(0.7) brightness(1.12) blur(1.2px); }
.ld-compare-tag { position: absolute; top: 14px; font-size: 10px; font-weight: 800; letter-spacing: 0.1em; padding: 6px 11px; border-radius: 999px; background: rgba(255,255,255,0.95); color: var(--sky-700); pointer-events: none; }
.ld-compare-tag.after { background: var(--pink); color: #fff; }
.ld-compare-line { position: absolute; top: 0; bottom: 0; width: 3px; margin-left: -1.5px; background: #fff; box-shadow: 0 0 20px rgba(2,50,74,0.5); pointer-events: none; }
.ld-compare-knob { position: absolute; top: 50%; left: 50%; width: 46px; height: 46px; margin: -23px 0 0 -23px; border-radius: 50%; background: var(--pink); border: 3px solid #fff; display: flex; align-items: center; justify-content: center; box-shadow: 0 10px 24px rgba(216,57,149,0.55); }
.ld-compare-range { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: ew-resize; }
.ld-compare:focus-within { outline: 3px solid var(--pink); outline-offset: 3px; }

/* manifesto */
.ld-pillars { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }

/* final */
.ld-final { position: relative; overflow: hidden; padding: 120px 24px 130px; background: linear-gradient(165deg, #0aa2d8 0%, #0593C6 50%, #036A91 100%); }
.ld-final .ld-orb.pink { right: -8vw; bottom: -14vw; } .ld-final .ld-orb.cyan { left: -10vw; top: -14vw; }
.ld-final > * { position: relative; z-index: 2; } .ld-final > .ld-orb, .ld-final > .ld-stripes { position: absolute; z-index: 0; }

/* footer */
.ld-footer { display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap; padding: 28px 48px; background: var(--white); color: var(--fg-3); font-size: 13px; }
.ld-footer-logo { font-weight: 700; font-size: 18px; color: var(--ink); letter-spacing: -0.02em; }
.ld-footer-links { display: flex; gap: 20px; align-items: center; flex-wrap: wrap; }
.ld-footer-links button { background: none; border: 0; cursor: pointer; color: var(--sky-700); font-weight: 700; font-size: 13px; }
.ld-footer-links button:hover { color: var(--pink-600); }

/* responsive */
@media (max-width: 1100px) {
  .ld-hero-grid { grid-template-columns: 1fr; padding: 28px 24px 10px; gap: 20px; }
  .ld-stage { height: 460px; max-width: 560px; margin: 0 auto; width: 100%; }
  .ld-strip { grid-template-columns: repeat(3, 1fr); width: calc(100% - 48px); }
  .ld-strip-item:nth-child(3) { border-right: 0; } .ld-strip-item:nth-child(n+4) { border-top: 1px solid rgba(255,255,255,0.2); }
  .ld-split { grid-template-columns: 1fr; gap: 36px; }
  .ld-showcase { column-count: 2; }
  .ld-bento .b1, .ld-bento .b2, .ld-bento .b3, .ld-bento .b4, .ld-bento .b5 { grid-column: span 6; }
  .ld-links { display: none; }
}
@media (max-width: 700px) {
  .ld-nav { margin-top: 10px; top: 10px; }
  .ld-signin { display: none; }
  .ld-h1 { font-size: clamp(40px, 12.5vw, 64px); }
  .ld-stage { height: 400px; }
  .ld-strip { grid-template-columns: 1fr 1fr; width: calc(100% - 32px); }
  .ld-strip-item { border-right: 0 !important; border-top: 1px solid rgba(255,255,255,0.2); } .ld-strip-item:first-child { border-top: 0; }
  .ld-section { padding: 64px 20px; }
  .ld-showcase { column-count: 1; }
  .ld-pillars { grid-template-columns: 1fr; }
  .ld-footer { padding: 24px 20px; }
  .ld-card { padding: 24px; border-radius: 24px; }
}
@media (prefers-reduced-motion: reduce) {
  .ld-word > span, .ld-rise, .ld-reveal { opacity: 1 !important; transform: none !important; animation: none !important; }
  .ld-squiggle path { stroke-dashoffset: 0 !important; animation: none !important; }
}
`;
