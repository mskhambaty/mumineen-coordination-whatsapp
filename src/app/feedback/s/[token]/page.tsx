"use client";

import { use, useEffect, useMemo, useState } from "react";

import { isProblemAnswer } from "@/lib/surveys/sentiment";

// Public, frictionless feedback-survey form. The token in the URL identifies the mumin + form;
// we show their first name to confirm before submit. Mirrors the webinars page styling.

type Question = {
  form_question_id: string;
  question_id: string | null;
  area: string | null;
  snapshot: {
    text: string;
    type: "choice" | "scale10" | "scale5" | "yesno" | "text" | "multichoice";
    options?: { label: string }[] | null;
    negative_values?: string[] | null;
    comment_threshold?: number | null;
    collect_comment?: boolean;
    required?: boolean;
    // Conditional display: show this question only when answer to `qid` equals `equals`
    // (e.g. the MUS questions appear only if the "Did you visit Mahal Us Shifa?" gate = "Yes").
    show_if?: { qid: string; equals: string } | null;
    // Render a yes/no as a single checkbox (checked = "Yes", off by default) — used for gate prompts.
    checkbox?: boolean;
  };
};
type Section = { section_id: string | null; title: string; questions: Question[] };
type LoadedForm = {
  status: "ok" | "not_found" | "closed" | "completed";
  recipientId?: string;
  firstName?: string | null;
  formTitle?: string;
  sections?: Section[];
};

const QUAL_SCALE = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];

export default function SurveyFormPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [form, setForm] = useState<LoadedForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/feedback-survey/${token}`)
      .then((r) => r.json())
      .then((d: LoadedForm) => setForm(d))
      .catch(() => setForm({ status: "not_found" }))
      .finally(() => setLoading(false));
  }, [token]);

  const allQuestions = useMemo(
    () => (form?.sections ?? []).flatMap((s) => s.questions),
    [form],
  );
  // A gated question shows only when its trigger answer matches (e.g. MUS questions when the
  // "Did you visit Mahal Us Shifa?" gate = "Yes"). Hidden questions don't count toward progress,
  // required-checks, or the submitted payload.
  const isVisible = (q: Question) => {
    const cond = q.snapshot.show_if;
    return !cond || (answers[cond.qid] ?? "") === cond.equals;
  };
  const visibleQuestions = allQuestions.filter(isVisible);
  const answeredCount = visibleQuestions.filter((q) => (answers[q.question_id ?? ""] ?? "").trim()).length;
  const progress = visibleQuestions.length ? Math.round((answeredCount / visibleQuestions.length) * 100) : 0;

  // Smoothly bring the question after `qid` into view (the auto-advance transition).
  function scrollToNext(qid: string) {
    const idx = allQuestions.findIndex((q) => (q.question_id ?? q.form_question_id) === qid);
    const next = allQuestions[idx + 1];
    if (!next) return;
    const nid = next.question_id ?? next.form_question_id;
    setTimeout(() => document.getElementById(`q-${nid}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 70);
  }

  function setAnswer(qid: string, value: string, snap: Question["snapshot"]) {
    const type = snap.type;
    setAnswers((a) => ({ ...a, [qid]: value }));
    const isNeg = isProblemAnswer(type, value, snap.negative_values ?? [], { threshold: snap.comment_threshold, collectComment: snap.collect_comment });
    // Clear a stale reason if the new answer isn't a problem answer.
    if (!isNeg) setReasons((r) => ({ ...r, [qid]: "" }));
    // Free-text fires onChange per keystroke — never collapse/scroll it (would steal focus). Keep
    // it expanded. Multi-select stays open too: one tap is rarely the final answer, so collapsing
    // after the first checkbox would cut the respondent off mid-selection.
    if (type === "text" || type === "multichoice" || snap.checkbox) { setExpanded((e) => ({ ...e, [qid]: true })); return; }
    // Negative answers stay expanded so the "why?" box shows (they collapse on the reason's onBlur).
    if (isNeg) { setExpanded((e) => ({ ...e, [qid]: true })); return; }
    // Non-negative: keep the selection visible for a beat, then collapse + auto-scroll — a calmer,
    // smoother transition than an instant snap.
    setExpanded((e) => ({ ...e, [qid]: true }));
    window.setTimeout(() => { setExpanded((e) => ({ ...e, [qid]: false })); scrollToNext(qid); }, 320);
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    // Enforce mandatory questions before sending.
    const firstMissing = allQuestions.find((q) => {
      if (!q.snapshot.required || !isVisible(q)) return false;
      const qid = q.question_id ?? q.form_question_id;
      return !(answers[qid] ?? "").trim();
    });
    if (firstMissing) {
      const qid = firstMissing.question_id ?? firstMissing.form_question_id;
      setExpanded((e) => ({ ...e, [qid]: true }));
      setError("Please answer the required questions (marked *).");
      setSubmitting(false);
      setTimeout(() => document.getElementById(`q-${qid}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
      return;
    }
    const payload = {
      answers: allQuestions
        .map((q) => {
          if (!isVisible(q)) return null; // don't submit answers to gated-hidden questions
          const qid = q.question_id ?? "";
          const value = (answers[qid] ?? "").trim();
          if (!value) return null;
          const reason = (reasons[qid] ?? "").trim() || null;
          return { question_id: qid, value, reason };
        })
        .filter(Boolean),
    };
    if (payload.answers.length === 0) {
      setError("Please answer at least one question.");
      setSubmitting(false);
      return;
    }
    const res = await fetch(`/api/feedback-survey/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    setSubmitting(false);
    if (!res.ok) { setError(json.error ?? "Could not submit. Please try again."); return; }
    setDone(true);
  }

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-gray-950 text-gray-400">Loading…</div>;
  }
  if (!form || (form.status !== "ok" && form.status !== "completed")) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950 px-6 text-center">
        <div className="max-w-sm text-gray-300">
          <h1 className="mb-2 text-lg font-semibold text-white">
            {form?.status === "closed" ? "This survey has closed" : "Survey link not found"}
          </h1>
          <p className="text-sm text-gray-500">
            {form?.status === "closed"
              ? "Shukran — this feedback round is no longer accepting responses."
              : "This link may have expired or already been used. Please check the latest message we sent you."}
          </p>
        </div>
      </div>
    );
  }
  // Done: either just submitted (done) or re-opening an already-submitted (locked) link.
  if (done || form.status === "completed") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950 px-6 text-center">
        <div className="max-w-sm">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-600 to-green-700">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-8 w-8 text-white"><path strokeLinecap="round" strokeLinejoin="round" d="M20 6 9 17l-5-5" /></svg>
          </div>
          <h1 className="mb-1 text-xl font-bold text-white">Shukran{form.firstName ? `, ${form.firstName}` : ""}!</h1>
          <p className="text-sm text-gray-400">
            {done ? "Your feedback has been recorded. It helps us improve the khidmat for all mumineen." : "This feedback has already been submitted — it can only be filled once. Shukran for your response."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <style>{`@keyframes surveyCollapseIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}`}</style>
      <div className="sticky top-0 z-20 h-1.5 w-full bg-white/10">
        <div className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all" style={{ width: `${progress}%` }} />
      </div>
      <header className="border-b border-white/10 bg-gradient-to-br from-blue-900/40 to-gray-950 px-5 py-6 text-center">
        <p className="text-xs uppercase tracking-widest text-blue-300/80">Ashara Mubaraka 1448H · Chicago Relay Centre</p>
        <h1 className="mt-1 text-xl font-bold">{form.formTitle ?? "Mumineen Feedback"}</h1>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-6">
        {(form.sections ?? []).map((section) => (
          <section key={section.section_id ?? section.title} className="mb-5 overflow-hidden rounded-2xl border border-white/10 bg-white/5">
            <div className="border-b border-white/10 bg-white/5 px-5 py-3">
              <h2 className="text-sm font-semibold text-white">{section.title}</h2>
            </div>
            <div className="divide-y divide-white/5">
              {section.questions.map((q) => {
                if (!isVisible(q)) return null; // gated question — hidden until its trigger is met
                const qid = q.question_id ?? q.form_question_id;
                const value = answers[qid] ?? "";
                // Gate prompt: a single checkbox to the LEFT of the question text (off by default).
                if (q.snapshot.type === "yesno" && q.snapshot.checkbox) {
                  const checked = value === "Yes";
                  return (
                    <div key={q.form_question_id} id={`q-${qid}`} className="scroll-mt-24 px-5 py-4">
                      <button
                        type="button"
                        onClick={() => setAnswer(qid, checked ? "" : "Yes", q.snapshot)}
                        className={`flex w-full items-center gap-3 text-left text-sm transition ${checked ? "font-medium text-white" : "text-gray-200"}`}
                      >
                        <span className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border ${checked ? "border-blue-400 bg-blue-500" : "border-white/40"}`}>
                          {checked && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="h-3 w-3 text-white"><path strokeLinecap="round" strokeLinejoin="round" d="M20 6 9 17l-5-5" /></svg>}
                        </span>
                        <span>{q.snapshot.text}</span>
                      </button>
                    </div>
                  );
                }
                const negVals = q.snapshot.negative_values ?? [];
                const isNeg = isProblemAnswer(q.snapshot.type, value, negVals, { threshold: q.snapshot.comment_threshold, collectComment: q.snapshot.collect_comment });
                const reason = reasons[qid] ?? "";
                // Collapse once answered (so the next question surfaces). Negative answers also
                // collapse — but only after the "why?" box (they stay expanded until then). Tap a
                // collapsed question to change the answer.
                const collapsed = Boolean(value) && !expanded[qid];
                if (collapsed) {
                  return (
                    <button
                      key={q.form_question_id}
                      id={`q-${qid}`}
                      type="button"
                      onClick={() => setExpanded((e) => ({ ...e, [qid]: true }))}
                      style={{ animation: "surveyCollapseIn 0.35s ease" }}
                      className="flex w-full items-start justify-between gap-3 px-5 py-3 text-left transition hover:bg-white/[0.03]"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-gray-400">{q.snapshot.text}{q.snapshot.required ? <span className="text-red-400">*</span> : null}</span>
                        {isNeg && reason && <span className="mt-0.5 block truncate text-xs italic text-amber-300/80">“{reason}”</span>}
                      </span>
                      <span className={`flex flex-shrink-0 items-center gap-1.5 text-sm font-medium ${isNeg ? "text-amber-400" : "text-emerald-400"}`}>
                        {value}
                        {isNeg ? (
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-3.5 w-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>
                        ) : (
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-3.5 w-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M20 6 9 17l-5-5" /></svg>
                        )}
                      </span>
                    </button>
                  );
                }
                return (
                  <div key={q.form_question_id} id={`q-${qid}`} className="scroll-mt-24 px-5 py-4">
                    <p className="mb-3 text-sm font-medium text-gray-100">{q.snapshot.text}{q.snapshot.required ? <span className="ml-0.5 text-red-400" title="Required">*</span> : null}</p>
                    <QuestionInput question={q} value={value} onChange={(v) => setAnswer(qid, v, q.snapshot)} />
                    {isNeg && (
                      <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
                        <label className="mb-1.5 block text-xs font-medium text-amber-300/90">Sorry to hear that — what was the main issue? <span className="text-amber-300/50">(optional)</span></label>
                        <input
                          type="text"
                          value={reason}
                          onChange={(e) => setReasons((r) => ({ ...r, [qid]: e.target.value }))}
                          onBlur={() => { setExpanded((e) => ({ ...e, [qid]: false })); scrollToNext(qid); }}
                          placeholder="Briefly tell us why… (tap away to continue)"
                          className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}

        {error && <p className="mb-3 rounded-xl bg-red-950/50 px-4 py-3 text-sm text-red-400">{error}</p>}

        <div className="sticky bottom-0 -mx-4 border-t border-white/10 bg-gray-950/90 px-4 py-4 backdrop-blur">
          <p className="mb-2 text-center text-xs text-gray-400">
            Submitting as <span className="font-semibold text-gray-200">{form.firstName ?? "you"}</span> — is this you?
          </p>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || answeredCount === 0}
            className="w-full rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 py-3 text-sm font-semibold text-white shadow-lg transition hover:from-blue-500 hover:to-indigo-500 disabled:opacity-50"
          >
            {submitting ? "Submitting…" : `Submit feedback (${answeredCount}/${allQuestions.length})`}
          </button>
        </div>
      </main>
    </div>
  );
}

function QuestionInput({ question, value, onChange }: { question: Question; value: string; onChange: (v: string) => void }) {
  const { type, options } = question.snapshot;

  if (type === "text") {
    return (
      <textarea
        rows={3}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Type your answer…"
        className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
      />
    );
  }

  if (type === "scale10" || type === "scale5") {
    const scale = type === "scale10" ? QUAL_SCALE : QUAL_SCALE.slice(0, 5);
    return (
      <div className="flex flex-wrap gap-2">
        {scale.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={`flex h-10 w-10 items-center justify-center rounded-lg border text-sm font-medium transition ${
              value === n ? "border-blue-500 bg-blue-600 text-white" : "border-white/10 bg-white/5 text-gray-300 hover:border-white/30"
            }`}
          >
            {n}
          </button>
        ))}
      </div>
    );
  }

  if (type === "multichoice") {
    // Multi-select: value is the chosen labels joined by " | " (preserving option order). An "Other"
    // choice is stored as "Other: <free text>" so the specifics are captured.
    const opts = options ?? [];
    const tokens = value ? value.split(" | ") : [];
    const isOtherTok = (t: string) => t === "Other" || t.startsWith("Other:");
    const selected = new Set(tokens.map((t) => (isOtherTok(t) ? "Other" : t)));
    const otherTok = tokens.find(isOtherTok);
    const otherText = otherTok && otherTok.startsWith("Other:") ? otherTok.slice(6).trim() : "";
    const build = (sel: Set<string>, otherTxt: string) =>
      opts
        .filter((o) => sel.has(o.label))
        .map((o) => (o.label === "Other" ? (otherTxt.trim() ? `Other: ${otherTxt.trim()}` : "Other") : o.label))
        .join(" | ");
    const toggle = (label: string) => {
      const next = new Set(selected);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      onChange(build(next, otherText));
    };
    const setOther = (txt: string) => { const next = new Set(selected); next.add("Other"); onChange(build(next, txt)); };
    return (
      <div className="flex flex-col gap-2">
        {opts.map((opt) => {
          const on = selected.has(opt.label);
          return (
            <div key={opt.label}>
              <button
                type="button"
                onClick={() => toggle(opt.label)}
                className={`flex w-full items-center gap-3 rounded-xl border px-4 py-2.5 text-left text-sm transition ${on ? "border-blue-500 bg-blue-600/15 font-medium text-white" : "border-white/10 bg-white/5 text-gray-200 hover:border-white/30"}`}
              >
                <span className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${on ? "border-blue-400 bg-blue-500" : "border-white/30"}`}>
                  {on && <span className="h-2 w-2 rounded-[1px] bg-white" />}
                </span>
                {opt.label}
              </button>
              {opt.label === "Other" && on && (
                <input
                  value={otherText}
                  onChange={(e) => setOther(e.target.value)}
                  placeholder="Please specify…"
                  className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
                />
              )}
            </div>
          );
        })}
      </div>
    );
  }

  const choices = type === "yesno" ? [{ label: "Yes" }, { label: "No" }] : options ?? [];
  return (
    <div className="flex flex-col gap-2">
      {choices.map((opt) => (
        <button
          key={opt.label}
          type="button"
          onClick={() => onChange(opt.label)}
          className={`flex items-center gap-3 rounded-xl border px-4 py-2.5 text-left text-sm transition ${
            value === opt.label ? "border-blue-500 bg-blue-600/15 font-medium text-white" : "border-white/10 bg-white/5 text-gray-200 hover:border-white/30"
          }`}
        >
          <span className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border ${value === opt.label ? "border-blue-400 bg-blue-500" : "border-white/30"}`}>
            {value === opt.label && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
          </span>
          {opt.label}
        </button>
      ))}
    </div>
  );
}
