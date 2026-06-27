"use client";

import { use, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

// Public, token-scoped Ashara 1448H knowledge quiz. The token in the URL identifies the taker.
// Flow: branded preloader → ready/start screen (pick time-per-question) → one question at a time
// with a countdown + instant feedback → server-graded score + review.
//
// Bilingual rule: the language toggle switches ONLY the question/answer content (question, options,
// explanation, clue) between English and Lisan ud Dawat. All UI chrome (title, labels, buttons,
// greeting) stays English. When a question's `ld` translation is missing, that question's content
// falls back to English. Lisan content renders RTL in the Kanz al-Marjaan font.
//
// The majlis is not shown on the card — it's revealed (with a hint) only via the clue bulb. Pure
// presentation: data/grading/idempotency live server-side (src/lib/quiz/*).

type QLang = { question: string; options: string[]; explanation: string; hint: string };
type QQ = { id: string; majlis: string; majlis_ld: string; correct_index: number; en: QLang; ld: QLang | null };
type Loaded =
  | { status: "ok"; quiz_key: string; title_en: string; title_ld: string; first_name: string | null; questions: QQ[]; requires_identity?: boolean }
  | { status: "completed"; first_name: string | null; score: number | null; total: number | null }
  | { status: "not_found" };
type Lang = "en" | "ld";

// Deep Fatemi palette.
const C = {
  cream: "#f6f1e6",
  emerald: "#0a3d2e",
  emDeep: "#072a20",
  gold: "#d4af5a",
  goldSoft: "#ecd9a4",
  clue: "#faf3e0",
  ink: "#241f16",
  mut: "#8c8472",
  card: "#ffffff",
  border: "#ece4d3",
  wrong: "#bb5238",
  wrongBg: "#f6e7e1",
  okBg: "#e2efe7",
};
const DISPLAY = "'Fredoka', var(--font-geist-sans), sans-serif";
const BODY = "'Plus Jakarta Sans', var(--font-geist-sans), sans-serif";
const LOGO_ALT = "Ashara Mubaraka 1448H — Chicago Relay Center";
const TIMES = [60, 90, 120] as const;

function shuffle(n: number): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let j = n - 1; j > 0; j--) {
    const r = Math.floor(Math.random() * (j + 1));
    [a[j], a[r]] = [a[r], a[j]];
  }
  return a;
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, s) % 60).padStart(2, "0")}`;

const Bulb = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M9 18h6" />
    <path d="M10 21h4" />
    <path d="M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.2 1 2.5h6c0-1.3.3-1.8 1-2.5A6 6 0 0 0 12 3z" />
  </svg>
);

const Clock = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

const Icon = ({ d, size = 16, sw = 2 }: { d: string; size?: number; sw?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {d.split("|").map((p, k) => (
      <path key={k} d={p} />
    ))}
  </svg>
);
const I_CHECK = "M20 6 9 17l-5-5";
const I_X = "M18 6 6 18|M6 6l12 12";
const I_ID = "M3 5h18v14H3z|M7 10h.01|M7 14h4|M13 9h5|M13 13h5";
const I_USER = "M5 20a7 7 0 0 1 14 0|M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z";

// Tiered, encouraging result headline by percentage.
function tier(pct: number): string {
  if (pct >= 87) return "Mumtaz!";
  if (pct >= 67) return "Mashallah!";
  if (pct >= 40) return "Good effort!";
  return "Keep going!";
}
// Logo in a white rounded badge (the artwork is full-colour on white).
const LogoBadge = ({ box = 38, img = 32 }: { box?: number; img?: number }) => (
  <span style={{ width: box, height: box, borderRadius: 10, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flex: "none" }}>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src="/logo.jpg" alt={LOGO_ALT} style={{ width: img, height: img, objectFit: "contain" }} />
  </span>
);

const FontStyle = (
  <style>{`@import url('https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');
  @font-face{font-family:'KanzalMarjaan';src:url('/fonts/KanzalMarjaan.woff2') format('woff2'),url('/fonts/KanzalMarjaan.ttf') format('truetype');font-display:swap}
  .lisan{font-family:'KanzalMarjaan','Noto Naskh Arabic',serif}
  @keyframes quizpulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(.94)}}
  @keyframes quizpop{0%{transform:scale(.6);opacity:0}60%{transform:scale(1.08)}100%{transform:scale(1);opacity:1}}
  @keyframes quizrise{0%{transform:translateY(10px);opacity:0}100%{transform:translateY(0);opacity:1}}`}</style>
);

// Slide-to-start control (drag the knob to the end to begin), like the reference quiz app.
function SlideToStart({ onComplete, disabled }: { onComplete: () => void; disabled?: boolean }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const xRef = useRef(0);
  const [x, setX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const KNOB = 48;
  const maxX = () => Math.max(0, (trackRef.current?.clientWidth ?? 0) - KNOB - 8);
  const set = (v: number) => {
    xRef.current = v;
    setX(v);
  };
  const onDown = (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const onMove = (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (!dragging || disabled || !trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    set(Math.max(0, Math.min(maxX(), e.clientX - rect.left - KNOB / 2 - 4)));
  };
  const onUp = (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (!dragging) return;
    setDragging(false);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (xRef.current >= maxX() - 6) {
      set(maxX());
      onComplete();
    } else {
      set(0);
    }
  };
  const m = maxX();
  const progress = m > 0 ? x / m : 0;
  return (
    <div
      ref={trackRef}
      style={{ position: "relative", height: 56, borderRadius: 999, background: disabled ? "#e7ddc8" : C.emerald, boxShadow: disabled ? "none" : "0 6px 16px rgba(10,61,46,0.28)", overflow: "hidden", userSelect: "none", touchAction: "none" }}
    >
      <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", paddingLeft: 44, fontFamily: DISPLAY, fontWeight: 600, fontSize: 16, color: disabled ? "#a89a78" : "rgba(255,255,255,0.92)", opacity: 1 - progress }}>
        {disabled ? "Enter ITS & name" : "Slide to start"}
      </span>
      <span
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        role="button"
        aria-label="Slide to start the quiz"
        style={{ position: "absolute", top: 4, left: 4, transform: `translateX(${x}px)`, transition: dragging ? "none" : "transform .2s ease", width: KNOB, height: KNOB, borderRadius: "50%", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", color: C.emerald, cursor: disabled ? "not-allowed" : "grab", boxShadow: "0 2px 6px rgba(0,0,0,0.18)" }}
      >
        <Icon d="M5 12h14|M13 6l6 6-6 6" size={22} sw={2.5} />
      </span>
    </div>
  );
}

export default function QuizPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [data, setData] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [lang, setLang] = useState<Lang>("en");
  const [started, setStarted] = useState(false);
  const [duration, setDuration] = useState<number>(90);
  const [remaining, setRemaining] = useState(90);
  const [its, setIts] = useState("");
  const [name, setName] = useState("");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [i, setI] = useState(0);
  const [chosen, setChosen] = useState<Record<string, number>>({});
  const [orders, setOrders] = useState<Record<string, number[]>>({});
  const [clueOpen, setClueOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ score: number; total: number } | null>(null);

  // Dev-only preview: `/quiz/<anything>?preview=1` loads the bundled questions and grades
  // client-side so the UI can be tested locally without a database. Records nothing; never
  // available in production.
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    const isPreview =
      process.env.NODE_ENV !== "production" &&
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).has("preview");
    if (isPreview) {
      setPreview(true);
      import("@/lib/quiz/questions").then((m) => {
        const qs: QQ[] = m.QUIZ_QUESTIONS.map((q) => ({
          id: q.id,
          majlis: q.majlis,
          majlis_ld: q.majlisLd,
          correct_index: q.correctIndex,
          en: q.en,
          ld: q.ld,
        }));
        setData({ status: "ok", quiz_key: m.QUIZ_KEY, title_en: m.QUIZ_TITLE_EN, title_ld: m.QUIZ_TITLE_LD, first_name: null, questions: qs, requires_identity: true });
        setOrders(Object.fromEntries(qs.map((q) => [q.id, shuffle(q.en.options.length)])));
        setLoading(false);
      });
      return;
    }
    fetch(`/api/quiz/${token}`)
      .then((r) => r.json())
      .then((d: Loaded) => {
        setData(d);
        if (d.status === "ok") setOrders(Object.fromEntries(d.questions.map((q) => [q.id, shuffle(q.en.options.length)])));
      })
      .catch(() => setData({ status: "not_found" }))
      .finally(() => setLoading(false));
  }, [token]);

  const questions = data?.status === "ok" ? data.questions : [];
  const isLd = (q: QQ) => lang === "ld" && q.ld != null;
  const pack = (q: QQ): QLang => (isLd(q) ? q.ld! : q.en);

  function goNext() {
    if (i === questions.length - 1) submit();
    else {
      setI((x) => x + 1);
      setClueOpen(false);
    }
  }

  // Reset the per-question countdown whenever the question changes or the quiz starts.
  useEffect(() => {
    if (started) setRemaining(duration);
  }, [i, duration, started]);

  // Tick: count down while a question is unanswered; pause once answered. The advance is deferred
  // into the timeout callback (never called synchronously in the effect body) so a timeout advances
  // exactly one question.
  useEffect(() => {
    if (!started || result || data?.status !== "ok") return;
    const cur = questions[i];
    if (!cur || chosen[cur.id] !== undefined) return;
    const t = setTimeout(() => {
      if (remaining <= 1) goNext();
      else setRemaining(remaining - 1);
    }, 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, result, remaining, i, chosen, data]);

  async function submit() {
    if (preview) {
      const s = questions.filter((qq) => chosen[qq.id] === qq.correct_index).length;
      setResult({ score: s, total: questions.length });
      return;
    }
    setSubmitting(true);
    const answers = questions.map((q) => ({ question_id: q.id, chosen_index: chosen[q.id] ?? null }));
    const requiresIdentity = data?.status === "ok" && data.requires_identity === true;
    const timeTaken = startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0;
    const body = requiresIdentity
      ? { its_number: its.trim(), name: name.trim(), duration_seconds: duration, time_taken_seconds: timeTaken, answers }
      : { answers };
    try {
      const r = await fetch(`/api/quiz/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (d.score !== undefined) setResult({ score: d.score, total: d.total });
    } finally {
      setSubmitting(false);
    }
  }

  // Sliding English ⇄ Lisan pill. `onEmerald` styles it for the emerald header/hero.
  const langPill = (
    <div style={{ position: "relative", display: "inline-flex", background: "rgba(255,255,255,0.16)", border: "1px solid rgba(255,255,255,0.28)", borderRadius: 999, padding: 3 }}>
      <span style={{ position: "absolute", top: 3, bottom: 3, width: "calc(50% - 3px)", left: lang === "en" ? 3 : "50%", background: C.cream, borderRadius: 999, transition: "left .28s cubic-bezier(.4,1.25,.5,1)" }} />
      <button onClick={() => setLang("en")} style={{ position: "relative", zIndex: 1, cursor: "pointer", border: 0, background: "transparent", borderRadius: 999, padding: "5px 14px", fontSize: 12, fontWeight: 600, fontFamily: BODY, color: lang === "en" ? C.emerald : "rgba(255,255,255,0.85)" }}>
        English
      </button>
      <button onClick={() => setLang("ld")} className="lisan" style={{ position: "relative", zIndex: 1, cursor: "pointer", border: 0, background: "transparent", borderRadius: 999, padding: "5px 16px", fontSize: 14, fontWeight: 600, color: lang === "ld" ? C.emerald : "rgba(255,255,255,0.85)" }}>
        لسان الدعوة
      </button>
    </div>
  );

  // ----- Branded preloader -----
  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: C.cream, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20, fontFamily: BODY }}>
        {FontStyle}
        <div style={{ background: "#fff", borderRadius: 24, padding: "22px 26px", border: `1px solid ${C.border}`, animation: "quizpulse 1.6s ease-in-out infinite" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.jpg" alt={LOGO_ALT} style={{ width: 150, height: "auto", display: "block" }} />
        </div>
        <div style={{ display: "flex", gap: 7 }}>
          {[0, 1, 2].map((d) => (
            <span key={d} style={{ width: 8, height: 8, borderRadius: "50%", background: C.gold, animation: `quizpulse 1s ease-in-out ${d * 0.18}s infinite` }} />
          ))}
        </div>
      </div>
    );
  }

  if (!data || data.status === "not_found") {
    return (
      <div style={{ minHeight: "100vh", background: C.cream, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18, padding: "0 24px", textAlign: "center", fontFamily: BODY }}>
        {FontStyle}
        <LogoBadge box={72} img={62} />
        <p style={{ maxWidth: 340, color: C.ink }}>This quiz link is not valid or has expired.</p>
      </div>
    );
  }

  // ----- Result / already-completed screen -----
  if (data.status === "completed" || result) {
    const sc = result?.score ?? (data.status === "completed" ? data.score ?? 0 : 0);
    const tot = result?.total ?? (data.status === "completed" ? data.total ?? questions.length : questions.length);
    const pct = tot ? Math.round((sc / tot) * 100) : 0;
    const missed = Math.max(0, tot - sc);
    const firstName =
      (data.status === "completed" ? data.first_name : data.status === "ok" ? data.first_name : null) || (name.trim().split(/\s+/)[0] || null);
    const haveReview = !!result && data.status === "ok";
    return (
      <div style={{ minHeight: "100vh", background: C.cream, fontFamily: BODY }}>
        {FontStyle}
        <div style={{ maxWidth: 480, margin: "0 auto" }}>
          <div style={{ textAlign: "center", padding: "24px 22px 0" }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 16, animation: "quizpop .55s cubic-bezier(.3,1.4,.5,1) both" }}>
              <LogoBadge box={116} img={100} />
            </div>
            <h1 style={{ margin: "0 0 4px", fontFamily: DISPLAY, fontWeight: 700, fontSize: 28, color: C.ink, animation: "quizrise .5s ease .08s both" }}>{tier(pct)}</h1>
            {firstName && <p style={{ margin: 0, fontSize: 14, color: C.mut, lineHeight: 1.5, animation: "quizrise .5s ease .16s both" }}>{firstName}</p>}
          </div>

          <div style={{ padding: 18 }}>
            {/* Stat cards — quiz-app style */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, animation: "quizrise .5s ease .24s both" }}>
              {[
                { label: "Score", value: `${sc}/${tot}`, color: C.emerald, bar: C.emerald },
                { label: "Accuracy", value: `${pct}%`, color: "#a8812c", bar: C.gold },
                { label: "Missed", value: `${missed}`, color: C.wrong, bar: C.wrong },
              ].map((s) => (
                <div key={s.label} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, overflow: "hidden", textAlign: "center" }}>
                  <div style={{ height: 4, background: s.bar }} />
                  <div style={{ padding: "13px 4px 12px" }}>
                    <span style={{ display: "block", fontFamily: DISPLAY, fontWeight: 700, fontSize: 21, color: s.color, lineHeight: 1 }}>{s.value}</span>
                    <span style={{ display: "block", marginTop: 4, fontSize: 11, color: C.mut }}>{s.label}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* At-a-glance run: one pip per question */}
            {haveReview && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center", marginTop: 18 }}>
                {questions.map((q, n) => {
                  const ok = chosen[q.id] === q.correct_index;
                  return (
                    <span key={q.id} title={`Q${n + 1}`} style={{ width: 22, height: 22, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", background: ok ? C.okBg : C.wrongBg, color: ok ? C.emerald : C.wrong }}>
                      <Icon d={ok ? I_CHECK : I_X} size={12} sw={3} />
                    </span>
                  );
                })}
              </div>
            )}

            {haveReview && (
              <div style={{ marginTop: 24 }}>
                <p style={{ margin: "0 0 12px", fontFamily: DISPLAY, fontWeight: 600, fontSize: 15, color: C.ink }}>Review your answers</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {questions.map((q, n) => {
                    const ld = isLd(q);
                    const p = pack(q);
                    const picked = chosen[q.id];
                    const ok = picked === q.correct_index;
                    const cdir = ld ? "rtl" : "ltr";
                    const calign = ld ? "right" : "left";
                    const cls = ld ? "lisan" : "";
                    return (
                      <div key={q.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, overflow: "hidden" }}>
                        <div style={{ height: 4, background: ok ? C.emerald : C.wrong }} />
                        <div style={{ padding: "13px 15px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 9 }}>
                            <span style={{ width: 26, height: 26, borderRadius: 9, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", background: ok ? C.emerald : C.wrong, color: "#fff", fontFamily: DISPLAY, fontWeight: 700, fontSize: 13 }}>{n + 1}</span>
                            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: ok ? C.emerald : C.wrong }}>{ok ? "Correct" : "Missed"}</span>
                          </div>
                          <p style={{ margin: "0 0 10px", fontWeight: 600, fontSize: ld ? 20 : 15, lineHeight: ld ? 1.85 : 1.4, color: C.ink, textAlign: ld ? "justify" : calign }} dir={cdir} className={cls}>
                            {p.question}
                          </p>
                          {!ok && picked !== undefined && (
                            <p style={{ margin: "0 0 4px", fontSize: 13.5, color: C.wrong, textAlign: calign }} dir={cdir} className={cls}>
                              Your answer: {p.options[picked]}
                            </p>
                          )}
                          <p style={{ margin: 0, fontSize: 13.5, fontWeight: 500, color: C.emerald, textAlign: calign }} dir={cdir} className={cls}>
                            {ok ? "" : "Correct: "}
                            {p.options[q.correct_index]}
                          </p>
                          <p style={{ margin: "8px 0 0", fontSize: 12.5, color: C.mut, lineHeight: 1.6 }}>{q.en.explanation}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <p style={{ marginTop: 24, textAlign: "center", fontSize: 12, color: C.mut }}>Shukran for taking the quiz.</p>
          </div>
        </div>
      </div>
    );
  }

  // ----- Ready / start screen (identity + pick time per question) -----
  if (!started) {
    const needsId = data.requires_identity === true;
    const itsValid = /^\d{8}$/.test(its.trim());
    const canStart = !needsId || (itsValid && name.trim().length > 0);
    return (
      <div style={{ minHeight: "100vh", background: C.cream, fontFamily: BODY }}>
        {FontStyle}
        <div style={{ maxWidth: 480, margin: "0 auto" }}>
          <div style={{ background: C.emerald, padding: "34px 24px 30px", borderRadius: "0 0 30px 30px", textAlign: "center" }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
              <LogoBadge box={84} img={72} />
            </div>
            <p style={{ margin: "0 0 6px", fontFamily: DISPLAY, fontWeight: 600, fontSize: 20, color: "#fff", lineHeight: 1.25 }}>{data.title_en}</p>
            <p style={{ margin: 0, fontSize: 13, color: "rgba(255,255,255,0.8)" }}>{questions.length} questions</p>
          </div>

          <div style={{ padding: "22px 18px 26px" }}>
            <p style={{ margin: "0 0 4px", fontFamily: DISPLAY, fontWeight: 600, fontSize: 16, color: C.ink }}>Get ready</p>
            <p style={{ margin: "0 0 18px", fontSize: 13, color: C.mut, lineHeight: 1.6 }}>
              {needsId ? "Enter your ITS and name, choose your time per question, then begin." : "Choose how long you get for each question, then begin."} If the timer runs out, the quiz moves on to the next question.
            </p>

            {needsId && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 22 }}>
                <label style={{ display: "block" }}>
                  <span style={{ display: "block", margin: "0 0 6px", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: C.gold }}>ITS number</span>
                  <span style={{ position: "relative", display: "block" }}>
                    <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: C.gold, display: "flex" }}>
                      <Icon d={I_ID} size={18} />
                    </span>
                    <input
                      value={its}
                      onChange={(e) => setIts(e.target.value.replace(/\D/g, "").slice(0, 8))}
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder="8-digit ITS"
                      style={{ width: "100%", boxSizing: "border-box", height: 50, borderRadius: 14, border: `1.5px solid ${its.trim() && !itsValid ? C.wrong : C.border}`, background: C.card, padding: "0 14px 0 42px", fontFamily: BODY, fontSize: 15, color: C.ink, outline: "none" }}
                    />
                  </span>
                  {its.trim() && !itsValid && <span style={{ display: "block", marginTop: 5, fontSize: 12, color: C.wrong }}>Enter your 8-digit ITS number.</span>}
                </label>
                <label style={{ display: "block" }}>
                  <span style={{ display: "block", margin: "0 0 6px", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: C.gold }}>Name</span>
                  <span style={{ position: "relative", display: "block" }}>
                    <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: C.gold, display: "flex" }}>
                      <Icon d={I_USER} size={18} />
                    </span>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value.slice(0, 80))}
                      autoComplete="name"
                      placeholder="Your full name"
                      style={{ width: "100%", boxSizing: "border-box", height: 50, borderRadius: 14, border: `1.5px solid ${C.border}`, background: C.card, padding: "0 14px 0 42px", fontFamily: BODY, fontSize: 15, color: C.ink, outline: "none" }}
                    />
                  </span>
                </label>
              </div>
            )}

            <p style={{ margin: "0 0 9px", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: C.gold }}>Time per question</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 22 }}>
              {TIMES.map((s) => {
                const on = duration === s;
                return (
                  <button
                    key={s}
                    onClick={() => setDuration(s)}
                    style={{ cursor: "pointer", borderRadius: 14, padding: "14px 0", border: `1.5px solid ${on ? C.emerald : C.border}`, background: on ? C.emerald : C.card, color: on ? "#fff" : C.ink, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}
                  >
                    <span style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 22 }}>{s}</span>
                    <span style={{ fontSize: 11, color: on ? "rgba(255,255,255,0.8)" : C.mut }}>seconds</span>
                  </button>
                );
              })}
            </div>

            <SlideToStart
              disabled={!canStart}
              onComplete={() => {
                setStartedAt(Date.now());
                setStarted(true);
                setRemaining(duration);
              }}
            />
          </div>
        </div>
      </div>
    );
  }

  // ----- Question screen -----
  const q = questions[i];
  const ld = isLd(q);
  const p = pack(q);
  const cdir = ld ? "rtl" : "ltr";
  const calign = ld ? "right" : "left";
  const cls = ld ? "lisan" : "";
  const order = orders[q.id] ?? Array.from({ length: p.options.length }, (_, k) => k);
  const answered = chosen[q.id] !== undefined;
  const last = i === questions.length - 1;
  const total = questions.length;
  const low = !answered && remaining <= 10;
  const initial = ((data.first_name || name) ?? "").trim().charAt(0).toUpperCase() || "?";

  return (
    <div style={{ height: "100dvh", background: C.cream, fontFamily: BODY, display: "flex", flexDirection: "column" }}>
      {FontStyle}
      <div style={{ maxWidth: 480, width: "100%", margin: "0 auto", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {/* Header (stays put) — logo, title, identity avatar, language, progress + timer */}
        <div style={{ flex: "none", background: C.emerald, padding: "16px 18px 18px", borderRadius: "0 0 28px 28px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 14 }}>
            <LogoBadge />
            <p style={{ flex: 1, margin: 0, textAlign: "center", fontFamily: DISPLAY, fontWeight: 600, fontSize: 15, color: "#fff", lineHeight: 1.2 }}>{data.title_en}</p>
            <span aria-label="You" title={(data.first_name || name) || undefined} style={{ width: 38, height: 38, borderRadius: "50%", flex: "none", background: C.goldSoft, color: C.emerald, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: DISPLAY, fontWeight: 700, fontSize: 16 }}>
              {initial}
            </span>
          </div>

          <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>{langPill}</div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,0.85)" }}>
              Question {i + 1} / {total}
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: low ? "#f3b6a6" : C.goldSoft }}>
              <Clock />
              {fmt(remaining)}
            </span>
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            {Array.from({ length: total }, (_, k) => (
              <span key={k} style={{ flex: 1, height: 5, borderRadius: 999, background: k <= i ? C.goldSoft : "rgba(255,255,255,0.22)" }} />
            ))}
          </div>
        </div>

        {/* Body — the only scrolling region; header above + action tray below stay visible */}
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", WebkitOverflowScrolling: "touch", padding: "18px 16px 18px" }}>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 20, padding: "16px 17px", marginBottom: 14 }}>
            <p style={{ margin: 0, fontFamily: ld ? undefined : DISPLAY, fontWeight: 600, fontSize: ld ? 23 : 18, lineHeight: ld ? 1.7 : 1.4, color: C.ink, textAlign: ld ? "justify" : calign }} dir={cdir} className={cls}>
              {p.question}
            </p>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 11, marginBottom: 18 }}>
            {order.map((canonical, oi) => {
              const isChosen = chosen[q.id] === canonical;
              const isCorrect = canonical === q.correct_index;
              let bg = C.card;
              let bd = C.border;
              let clr = C.ink;
              let coinBg = "transparent";
              let coinBd = C.border;
              let coinClr = C.mut;
              if (answered) {
                if (isCorrect) {
                  bg = C.okBg;
                  bd = C.emerald;
                  clr = C.emerald;
                  coinBg = C.emerald;
                  coinBd = C.emerald;
                  coinClr = "#fff";
                } else if (isChosen) {
                  bg = C.wrongBg;
                  bd = C.wrong;
                  clr = C.wrong;
                  coinBg = C.wrong;
                  coinBd = C.wrong;
                  coinClr = "#fff";
                } else {
                  clr = "#b3ab98";
                  coinClr = "#c9c1ad";
                }
              } else if (isChosen) {
                bd = C.emerald;
                coinBg = C.emerald;
                coinBd = C.emerald;
                coinClr = "#fff";
              }
              const showMark = answered && (isCorrect || isChosen);
              return (
                <button
                  key={canonical}
                  disabled={answered}
                  onClick={() => setChosen((c) => ({ ...c, [q.id]: canonical }))}
                  dir={cdir}
                  style={{ display: "flex", flexDirection: ld ? "row-reverse" : "row", alignItems: "center", gap: 13, textAlign: calign, width: "100%", cursor: answered ? "default" : "pointer", background: bg, border: `1.5px solid ${bd}`, borderRadius: 16, padding: ld ? "13px 15px" : "13px 15px", fontFamily: ld ? undefined : BODY, fontWeight: 500, fontSize: ld ? 19 : 15, lineHeight: ld ? 1.55 : 1.3, color: clr }}
                  className={cls}
                >
                  <span style={{ flex: "none", width: 28, height: 28, borderRadius: 9, border: `1.5px solid ${coinBd}`, background: coinBg, color: coinClr, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: DISPLAY, fontWeight: 700, fontSize: 13 }}>
                    {showMark ? <Icon d={isCorrect ? I_CHECK : I_X} size={15} sw={3} /> : String.fromCharCode(65 + oi)}
                  </span>
                  <span style={{ flex: 1 }}>{p.options[canonical]}</span>
                </button>
              );
            })}
          </div>

          {answered && (
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: "14px 16px", marginBottom: 18 }}>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: chosen[q.id] === q.correct_index ? C.emerald : C.wrong }}>
                {chosen[q.id] === q.correct_index ? "Correct." : "Not quite."}
              </p>
              <p style={{ margin: "5px 0 0", fontSize: 13, color: C.mut, lineHeight: 1.6 }}>{q.en.explanation}</p>
            </div>
          )}

        </div>

        {/* Footer (stays put) — the clue reveal + the action tray remain visible while the body scrolls */}
        <div style={{ flex: "none", background: C.cream, padding: "10px 16px 16px", boxShadow: "0 -6px 16px rgba(36,31,22,0.06)" }}>
          {clueOpen && (
            <div style={{ background: C.clue, border: `1px solid ${C.goldSoft}`, borderRadius: 14, padding: "11px 14px", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, color: C.gold, marginBottom: 4 }}>
                <Bulb size={15} />
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>Clue</span>
              </div>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: C.ink }}>{q.majlis}</p>
              <p style={{ margin: "3px 0 0", fontSize: 13, color: C.mut, lineHeight: 1.6 }}>{q.en.hint}</p>
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#0b1310", borderRadius: 34, padding: "6px 6px 8px", boxShadow: "0 8px 20px rgba(0,0,0,0.22)" }}>
            <button
              onClick={() => setClueOpen((o) => !o)}
              aria-label={clueOpen ? "Hide clue" : "Show clue"}
              aria-pressed={clueOpen}
              style={{ flex: "none", width: 50, height: 50, borderRadius: "50%", border: 0, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", background: clueOpen ? C.gold : C.card, color: clueOpen ? "#fff" : "#b8892e" }}
            >
              <Bulb />
            </button>
            <button
              disabled={!answered || submitting}
              onClick={() => goNext()}
              style={{ flex: 1, height: 50, border: 0, borderRadius: 999, background: answered && !submitting ? "#1aa06b" : "#2c4a3f", color: "#fff", cursor: answered && !submitting ? "pointer" : "default", fontFamily: DISPLAY, fontWeight: 700, fontSize: 16 }}
            >
              {last ? "See results" : "Continue"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
