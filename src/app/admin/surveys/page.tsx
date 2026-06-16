"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { apiFetch, readAdminUser } from "@/lib/admin/client";

type Question = { id: string; section_id: string; text: string; type: string; is_general: boolean };
type Section = { id: string; title: string; area: string; is_general: boolean; questions: Question[] };
type Group = { id: string; name: string; description: string | null; area_focus: string | null };
type FormRow = {
  id: string; title: string; group_name: string | null; sample_size: number;
  status: string; event_date: string | null; recipient_count: number; completed_count: number;
};

type Tab = "compose" | "databank" | "forms";

const inputCls =
  "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500";

export default function SurveysAdminPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>("compose");
  const [sections, setSections] = useState<Section[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [forms, setForms] = useState<FormRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [groupId, setGroupId] = useState("");
  const [sampleSize, setSampleSize] = useState(40);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const loadDatabank = useCallback(async () => {
    const res = await apiFetch("/api/admin/surveys/databank");
    const json = await res.json().catch(() => ({}));
    setSections(json.sections ?? []);
    setGroups(json.groups ?? []);
  }, []);
  const loadForms = useCallback(async () => {
    const res = await apiFetch("/api/admin/surveys/forms");
    const json = await res.json().catch(() => ({}));
    setForms(json.forms ?? []);
  }, []);

  useEffect(() => {
    const user = readAdminUser();
    if (!user) { router.push("/admin/login"); return; }
    if (!isAdminOrLeadership(user)) { router.push("/admin"); return; }
    setReady(true);
    void loadDatabank();
    void loadForms();
  }, [router, loadDatabank, loadForms]);

  function toggle(qid: string) {
    setSelected((s) => { const n = new Set(s); if (n.has(qid)) n.delete(qid); else n.add(qid); return n; });
  }
  function selectGeneral() {
    const ids = sections.flatMap((s) => s.questions.filter((q) => s.is_general || q.is_general).map((q) => q.id));
    setSelected((s) => new Set([...s, ...ids]));
  }

  async function createForm() {
    setMsg(null);
    if (!title.trim() || !groupId || selected.size === 0) { setMsg("Pick a title, a group, and at least one question."); return; }
    const res = await apiFetch("/api/admin/surveys/forms", {
      method: "POST",
      body: JSON.stringify({ title: title.trim(), group_id: groupId, sample_size: sampleSize, question_ids: [...selected] }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { setMsg(json.error ?? "Failed to create form"); return; }
    setMsg(`Form created with ${json.question_count} questions.`);
    setTitle(""); setSelected(new Set());
    await loadForms();
    setTab("forms");
  }

  if (!ready) return null;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="mb-1 text-xl font-bold text-gray-900 dark:text-gray-100">Feedback Surveys</h1>
      <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">Compose targeted surveys, sample a group, and review section sentiment.</p>

      <div className="mb-5 flex gap-1 border-b border-gray-200 dark:border-gray-700">
        {(["compose", "forms", "databank"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize ${tab === t ? "border-b-2 border-blue-600 text-blue-600 dark:text-blue-400" : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"}`}>
            {t}
          </button>
        ))}
      </div>

      {msg && <p className="mb-4 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800 dark:bg-blue-950/50 dark:text-blue-300">{msg}</p>}

      {tab === "compose" && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Form title (e.g. Rahat — Day 3)" className={`${inputCls} sm:col-span-2`} />
            <input type="number" value={sampleSize} min={1} onChange={(e) => setSampleSize(parseInt(e.target.value || "0", 10))} placeholder="Sample size" className={inputCls} />
          </div>
          <select value={groupId} onChange={(e) => setGroupId(e.target.value)} className={`w-full ${inputCls}`}>
            <option value="">— Target group —</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}{g.area_focus ? ` (${g.area_focus})` : ""}</option>)}
          </select>

          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Questions ({selected.size} selected)</p>
            <button onClick={selectGeneral} className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400">+ Add all general questions</button>
          </div>
          <div className="space-y-3">
            {sections.map((s) => (
              <div key={s.id} className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
                <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-800/60">
                  <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">{s.title}</span>
                  <span className="text-[11px] uppercase text-gray-400 dark:text-gray-500">{s.area}{s.is_general ? " · general" : ""}</span>
                </div>
                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                  {s.questions.map((q) => (
                    <label key={q.id} className="flex cursor-pointer items-start gap-2 px-3 py-2 text-sm hover:bg-blue-50/50 dark:hover:bg-gray-800/50">
                      <input type="checkbox" checked={selected.has(q.id)} onChange={() => toggle(q.id)} className="mt-0.5 accent-blue-600" />
                      <span className="text-gray-700 dark:text-gray-300">{q.text} <span className="text-[10px] uppercase text-gray-400 dark:text-gray-500">({q.type})</span></span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <button onClick={createForm} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">Create form</button>
        </div>
      )}

      {tab === "forms" && <FormsTab forms={forms} reload={loadForms} />}

      {tab === "databank" && (
        <div className="space-y-3">
          {sections.map((s) => (
            <div key={s.id} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
              <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{s.title} <span className="text-[11px] uppercase text-gray-400 dark:text-gray-500">{s.area}</span></p>
              <ul className="mt-1 list-disc pl-5 text-sm text-gray-600 dark:text-gray-300">
                {s.questions.map((q) => <li key={q.id}>{q.text}</li>)}
              </ul>
              <AddQuestion sectionId={s.id} onAdded={loadDatabank} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AddQuestion({ sectionId, onAdded }: { sectionId: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [type, setType] = useState("yesno");
  const [saving, setSaving] = useState(false);

  async function add() {
    setSaving(true);
    const body: Record<string, unknown> = { section_id: sectionId, text: text.trim(), type };
    if (type === "choice") body.options = [{ label: "Excellent" }, { label: "Good" }, { label: "Fair" }, { label: "Poor" }];
    const res = await apiFetch("/api/admin/surveys/questions", { method: "POST", body: JSON.stringify(body) });
    setSaving(false);
    if (res.ok) { setText(""); setOpen(false); onAdded(); }
  }

  if (!open) return <button onClick={() => setOpen(true)} className="mt-2 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400">+ Add question</button>;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Question text" className={`flex-1 ${inputCls}`} />
      <select value={type} onChange={(e) => setType(e.target.value)} className={inputCls}>
        <option value="yesno">Yes/No</option><option value="choice">Choice (QUAL)</option>
        <option value="scale10">Scale 1-10</option><option value="scale5">Scale 1-5</option><option value="text">Text</option>
      </select>
      <button onClick={add} disabled={saving || text.trim().length < 3} className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-50">Add</button>
    </div>
  );
}

type Detail = { kind: string; id: string; [k: string]: unknown };

function FormsTab({ forms, reload }: { forms: FormRow[]; reload: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);

  async function call(id: string, kind: string, path: string, method = "GET") {
    setBusy(id);
    const res = await apiFetch(path, method === "GET" ? undefined : { method });
    setDetail({ kind, id, ...(await res.json().catch(() => ({}))) });
    setBusy(null);
  }
  async function send(id: string) {
    if (!confirm("Commit this sample? This locks the questions for those mumineen (they won't be re-asked).")) return;
    await call(id, "send", `/api/admin/surveys/forms/${id}/send`, "POST");
    reload();
  }
  async function testLink(id: string) {
    const its = window.prompt("Preview as ITS number (optional — blank = anonymous 'you' preview):", "")?.trim() ?? "";
    setBusy(id);
    const res = await apiFetch(`/api/admin/surveys/forms/${id}/test-link`, { method: "POST", body: JSON.stringify(its ? { its } : {}) });
    setDetail({ kind: "test", id, ...(await res.json().catch(() => ({}))) });
    setBusy(null);
  }
  async function del(id: string) {
    if (!confirm("Delete this form? This removes its questions, sample, and any responses. Its questions become askable again. This cannot be undone.")) return;
    setBusy(id);
    await apiFetch(`/api/admin/surveys/forms/${id}`, { method: "DELETE" });
    setBusy(null);
    setDetail(null);
    reload();
  }

  const ghostBtn = "rounded border border-gray-300 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800";

  return (
    <div className="space-y-2">
      {forms.length === 0 && <p className="text-sm text-gray-500 dark:text-gray-400">No forms yet — compose one.</p>}
      {forms.map((f) => (
        <div key={f.id} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{f.title}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {f.group_name ?? "—"} · status {f.status} · {f.completed_count}/{f.recipient_count} responded · sample {f.sample_size}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => testLink(f.id)} disabled={busy === f.id} className={ghostBtn}>Test link</button>
              <button onClick={() => call(f.id, "preview", `/api/admin/surveys/forms/${f.id}/preview`, "POST")} disabled={busy === f.id} className={ghostBtn}>Preview sample</button>
              <button onClick={() => send(f.id)} disabled={busy === f.id || f.status === "sent"} className="rounded bg-emerald-600 px-3 py-1 text-xs text-white disabled:opacity-50">
                {f.status === "sent" ? "Sent" : "Commit & send"}
              </button>
              <button onClick={() => call(f.id, "results", `/api/admin/surveys/forms/${f.id}/results`)} disabled={busy === f.id} className={ghostBtn}>Results</button>
              <button onClick={() => del(f.id)} disabled={busy === f.id} className="rounded border border-red-300 px-3 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40">Delete</button>
            </div>
          </div>
          {detail && detail.id === f.id && <DetailView detail={detail} />}
        </div>
      ))}
    </div>
  );
}

function copy(text: string) { void navigator.clipboard?.writeText(text); }

function PreviewSample({ detail }: { detail: Detail }) {
  const [q, setQ] = useState("");
  const f = (detail.funnel ?? {}) as Record<string, number>;
  const sample = (detail.sample ?? []) as { name: string; its: string; fresh: boolean }[];
  const ql = q.trim().toLowerCase();
  const filtered = ql ? sample.filter((s) => s.name.toLowerCase().includes(ql) || s.its.includes(ql)) : sample;
  return (
    <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/40">
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-700 dark:text-gray-300">
        <span><b>{f.candidates ?? 0}</b> qualify</span>
        <span><b>{f.chosen ?? 0}</b> chosen</span>
        <span className="text-emerald-600 dark:text-emerald-400">{f.fresh ?? 0} fresh</span>
        <span className="text-amber-600 dark:text-amber-400">{f.reused ?? 0} reused</span>
        <span className="text-gray-400">{f.excludedToday ?? 0} already today · {f.excludedExhausted ?? 0} exhausted</span>
      </div>
      {sample.length > 0 && (
        <>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search this sample by name or ITS…"
            className="mt-3 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:placeholder-gray-500"
          />
          <p className="mt-1 text-[11px] text-gray-400">{filtered.length} of {sample.length}{ql ? ` matching “${q}”` : " in sample"}</p>
          <div className="mt-1 max-h-64 divide-y divide-gray-100 overflow-auto dark:divide-gray-800">
            {filtered.map((s, i) => (
              <div key={i} className="flex items-center justify-between gap-3 py-1 text-xs">
                <span className="truncate text-gray-700 dark:text-gray-300">{s.name}</span>
                <span className="flex flex-shrink-0 items-center gap-2">
                  <span className="font-mono text-gray-400">{s.its}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] ${s.fresh ? "bg-emerald-600/20 text-emerald-700 dark:text-emerald-400" : "bg-amber-500/20 text-amber-700 dark:text-amber-400"}`}>{s.fresh ? "fresh" : "reused"}</span>
                </span>
              </div>
            ))}
            {filtered.length === 0 && <p className="py-2 text-xs text-gray-400">No one matching “{q}” in this sample.</p>}
          </div>
        </>
      )}
    </div>
  );
}

function SentimentBadge({ value }: { value: number | null }) {
  if (value == null) return <span className="text-xs text-gray-400">—</span>;
  const color = value >= 4 ? "bg-emerald-600" : value >= 3 ? "bg-amber-500" : "bg-red-600";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-1.5 w-16 overflow-hidden rounded bg-gray-200 dark:bg-gray-700">
        <span className={`block h-full ${color}`} style={{ width: `${(value / 5) * 100}%` }} />
      </span>
      <span className="text-xs font-medium text-gray-700 dark:text-gray-200">{value.toFixed(1)}/5</span>
    </span>
  );
}

function DetailView({ detail }: { detail: Detail }) {
  const box = "mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm dark:border-gray-700 dark:bg-gray-800/40";
  if (detail.error) return <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{String(detail.error)}</p>;

  if (detail.kind === "test") {
    const link = String(detail.link ?? "");
    const name = detail.name ? String(detail.name) : null;
    return (
      <div className={box}>
        <p className="mb-1 text-xs text-gray-500 dark:text-gray-400">
          {name ? `Previewing as ${name}. ` : "Anonymous preview (the form greets a generic “you” — real recipients see their first name). "}
          Open this link (or send it to yourself) to preview the live form. Test recipient — no exposures written, excluded from results.
        </p>
        <div className="flex items-center gap-2">
          <input readOnly value={link} className="flex-1 rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-800 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200" />
          <button onClick={() => copy(link)} className="rounded bg-blue-600 px-2 py-1 text-xs text-white">Copy</button>
          <a href={link} target="_blank" rel="noreferrer" className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 dark:border-gray-600 dark:text-gray-200">Open</a>
        </div>
      </div>
    );
  }

  if (detail.kind === "preview") return <PreviewSample detail={detail} />;

  if (detail.kind === "send") {
    const recipients = (detail.recipients ?? []) as { name: string | null; phone: string; link: string }[];
    return (
      <div className={box}>
        <p className="mb-2 text-sm font-medium text-gray-800 dark:text-gray-100">
          {detail.sent ? "Sent via WhatsApp." : "Committed (WhatsApp dispatch off) — share these links manually:"}
          {detail.sendError ? <span className="text-amber-600 dark:text-amber-400"> {String(detail.sendError)}</span> : null}
        </p>
        <div className="max-h-72 space-y-1 overflow-auto">
          {recipients.map((r, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="w-32 truncate text-gray-600 dark:text-gray-300">{r.name ?? r.phone}</span>
              <input readOnly value={r.link} className="flex-1 rounded border border-gray-300 bg-white px-2 py-0.5 text-gray-700 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300" />
              <button onClick={() => copy(r.link)} className="rounded bg-blue-600 px-2 py-0.5 text-white">Copy</button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (detail.kind === "results") {
    const resp = (detail.response ?? {}) as { sent: number; completed: number; rate: number };
    const sections = (detail.sections ?? []) as { section_id: string; title: string; sentiment: number | null; responses: number }[];
    const questions = (detail.questions ?? []) as { question_id: string; text: string; sentiment: number | null; breakdown: Record<string, number>; comments: string[] }[];
    return (
      <div className={box}>
        <p className="mb-3 text-sm font-medium text-gray-800 dark:text-gray-100">
          Response rate: {resp.completed}/{resp.sent} ({Math.round((resp.rate ?? 0) * 100)}%)
        </p>
        {sections.length > 0 && (
          <div className="mb-3">
            <p className="mb-1 text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Section sentiment</p>
            {sections.map((s) => (
              <div key={s.section_id} className="flex items-center justify-between py-0.5">
                <span className="text-xs text-gray-700 dark:text-gray-300">{s.title} <span className="text-gray-400">({s.responses})</span></span>
                <SentimentBadge value={s.sentiment} />
              </div>
            ))}
          </div>
        )}
        <div className="space-y-2">
          {questions.map((q) => (
            <div key={q.question_id} className="border-t border-gray-200 pt-2 dark:border-gray-700">
              <div className="flex items-start justify-between gap-3">
                <span className="text-xs text-gray-700 dark:text-gray-300">{q.text}</span>
                <SentimentBadge value={q.sentiment} />
              </div>
              {Object.keys(q.breakdown).length > 0 && (
                <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">{Object.entries(q.breakdown).map(([k, v]) => `${k}: ${v}`).join("  ·  ")}</p>
              )}
              {q.comments.length > 0 && (
                <ul className="mt-1 list-disc pl-4 text-[11px] italic text-gray-500 dark:text-gray-400">
                  {q.comments.slice(0, 8).map((c, i) => <li key={i}>{c}</li>)}
                </ul>
              )}
            </div>
          ))}
        </div>
        {sections.length === 0 && questions.length === 0 && <p className="text-xs text-gray-500 dark:text-gray-400">No responses yet.</p>}
      </div>
    );
  }

  return null;
}
