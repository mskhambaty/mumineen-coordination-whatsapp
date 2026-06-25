"use client";

import { use, useEffect, useMemo, useState } from "react";

// Public, token-scoped Ashara 1448H knowledge quiz. The token in the URL identifies the taker.
// One question at a time, instant feedback, then a server-graded score + review. Bilingual:
// English or Lisan ud Dawat (rendered RTL in the Kanz al-Marjaan font, with English fallback
// until a question's translation is fed in).

type QLang = { question: string; options: string[]; explanation: string };
type QQ = { id: string; majlis: string; majlis_ld: string; correct_index: number; en: QLang; ld: QLang | null };
type Loaded =
  | { status: "ok"; quiz_key: string; title_en: string; title_ld: string; first_name: string | null; questions: QQ[] }
  | { status: "completed"; first_name: string | null; score: number | null; total: number | null }
  | { status: "not_found" };
type Lang = "en" | "ld";

function shuffle(n: number): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let j = n - 1; j > 0; j--) {
    const r = Math.floor(Math.random() * (j + 1));
    [a[j], a[r]] = [a[r], a[j]];
  }
  return a;
}

export default function QuizPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [data, setData] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [lang, setLang] = useState<Lang>("en");
  const [i, setI] = useState(0);
  const [chosen, setChosen] = useState<Record<string, number>>({});
  const [orders, setOrders] = useState<Record<string, number[]>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ score: number; total: number } | null>(null);

  useEffect(() => {
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
  const rtl = lang === "ld";
  const t = (en: string, ld: string) => (rtl ? ld : en);

  const pack = (q: QQ): QLang => (rtl && q.ld ? q.ld : q.en);

  async function submit() {
    setSubmitting(true);
    const answers = questions.map((q) => ({ question_id: q.id, chosen_index: chosen[q.id] ?? null }));
    try {
      const r = await fetch(`/api/quiz/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      const d = await r.json();
      if (d.score !== undefined) setResult({ score: d.score, total: d.total });
    } finally {
      setSubmitting(false);
    }
  }

  const score = useMemo(() => questions.filter((q) => chosen[q.id] === q.correct_index).length, [questions, chosen]);

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-gray-950 text-gray-400">Loading…</div>;
  }
  if (!data || data.status === "not_found") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950 px-6 text-center">
        <p className="max-w-sm text-gray-300">This quiz link is not valid or has expired.</p>
      </div>
    );
  }

  const FontStyle = (
    <style>{`@font-face{font-family:'KanzalMarjaan';src:url('/fonts/KanzalMarjaan.woff2') format('woff2');font-display:swap}
    .lisan{font-family:'KanzalMarjaan','Noto Naskh Arabic',serif;direction:rtl}`}</style>
  );

  // Already taken — show their saved score.
  if (data.status === "completed" || result) {
    const sc = result?.score ?? (data.status === "completed" ? data.score ?? 0 : 0);
    const tot = result?.total ?? (data.status === "completed" ? data.total ?? questions.length : questions.length);
    const pct = tot ? Math.round((sc / tot) * 100) : 0;
    return (
      <div className="min-h-screen bg-gray-950 px-6 py-16 text-white">
        {FontStyle}
        <div className="mx-auto max-w-lg text-center">
          <p className="text-sm text-gray-400">{t("Your score", "تمارو اسکور")}</p>
          <p className="my-2 text-5xl font-bold text-emerald-400">
            {sc} / {tot}
          </p>
          <p className="text-gray-300">{pct}%</p>
          {result && data.status === "ok" && (
            <div className="mt-10 space-y-4 text-left">
              <p className="text-sm font-semibold text-gray-400">{t("Review", "مراجعو")}</p>
              {questions.map((q, n) => {
                const p = pack(q);
                const ok = chosen[q.id] === q.correct_index;
                return (
                  <div key={q.id} className="rounded-xl border border-gray-800 bg-gray-900 p-4">
                    <p className={`font-medium ${rtl ? "lisan text-right" : ""}`}>
                      {n + 1}. {p.question}
                    </p>
                    <p className={`mt-2 text-sm text-emerald-400 ${rtl ? "lisan text-right" : ""}`}>
                      {ok ? "✓ " : "✗ "}
                      {t("Answer: ", "جواب: ")}
                      {p.options[q.correct_index]}
                    </p>
                    <p className={`mt-1 text-sm text-gray-400 ${rtl ? "lisan text-right" : ""}`}>{p.explanation}</p>
                  </div>
                );
              })}
            </div>
          )}
          <p className="mt-10 text-xs text-gray-500">Shukran for taking the quiz.</p>
        </div>
      </div>
    );
  }

  const q = questions[i];
  const p = pack(q);
  const order = orders[q.id] ?? Array.from({ length: p.options.length }, (_, k) => k);
  const answered = chosen[q.id] !== undefined;
  const last = i === questions.length - 1;

  return (
    <div className="min-h-screen bg-gray-950 px-6 py-8 text-white">
      {FontStyle}
      <div className="mx-auto max-w-lg">
        <div className="mb-4 flex items-center justify-between">
          <span className={`text-sm text-gray-400 ${rtl ? "lisan" : ""}`}>{t(data.title_en, data.title_ld)}</span>
          <div className="inline-flex overflow-hidden rounded-lg border border-gray-700 text-xs">
            <button
              onClick={() => setLang("en")}
              className={`px-3 py-1 ${lang === "en" ? "bg-emerald-600 text-white" : "text-gray-400"}`}
            >
              English
            </button>
            <button
              onClick={() => setLang("ld")}
              className={`px-3 py-1 lisan ${lang === "ld" ? "bg-emerald-600 text-white" : "text-gray-400"}`}
            >
              لسان الدعوة
            </button>
          </div>
        </div>

        <div className="mb-2 flex justify-between text-xs text-gray-500">
          <span>{t(`Question ${i + 1} of ${questions.length}`, `سوال ${i + 1} / ${questions.length}`)}</span>
          <span>{t(`Score ${score}`, `اسکور ${score}`)}</span>
        </div>
        <div className="mb-5 h-1.5 overflow-hidden rounded bg-gray-800">
          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${(i / questions.length) * 100}%` }} />
        </div>

        <p className={`mb-1 text-xs text-gray-500 ${rtl ? "lisan text-right" : ""}`}>{rtl ? q.majlis_ld : q.majlis}</p>
        <p className={`mb-5 text-lg font-medium ${rtl ? "lisan text-right" : ""}`}>{p.question}</p>

        <div className="space-y-3" dir={rtl ? "rtl" : "ltr"}>
          {order.map((canonical) => {
            const isChosen = chosen[q.id] === canonical;
            const isCorrect = canonical === q.correct_index;
            let cls = "border-gray-700 bg-gray-900 hover:bg-gray-800";
            if (answered) {
              if (isCorrect) cls = "border-emerald-500 bg-emerald-950 text-emerald-200";
              else if (isChosen) cls = "border-red-500 bg-red-950 text-red-200";
              else cls = "border-gray-800 bg-gray-900 opacity-50";
            }
            return (
              <button
                key={canonical}
                disabled={answered}
                onClick={() => setChosen((c) => ({ ...c, [q.id]: canonical }))}
                className={`block w-full rounded-xl border px-4 py-3 text-left ${rtl ? "lisan text-right" : ""} ${cls}`}
              >
                {p.options[canonical]}
              </button>
            );
          })}
        </div>

        {answered && (
          <div className="mt-5 rounded-xl border border-gray-800 bg-gray-900 p-4">
            <p className={`text-sm ${chosen[q.id] === q.correct_index ? "text-emerald-400" : "text-red-400"}`}>
              {chosen[q.id] === q.correct_index ? t("Correct.", "صحيح۔") : t("Not quite.", "خوٹو۔")}
            </p>
            <p className={`mt-1 text-sm text-gray-300 ${rtl ? "lisan text-right" : ""}`}>{p.explanation}</p>
            <div className="mt-4 text-right">
              <button
                disabled={submitting}
                onClick={() => (last ? submit() : setI((x) => x + 1))}
                className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
              >
                {last ? t("See results", "نتيجو جوؤ") : t("Next question", "بيجو سوال")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
