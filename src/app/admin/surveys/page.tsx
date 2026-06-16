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

function FormsTab({ forms, reload }: { forms: FormRow[]; reload: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);

  async function preview(id: string) {
    setBusy(id);
    const res = await apiFetch(`/api/admin/surveys/forms/${id}/preview`, { method: "POST" });
    setDetail({ kind: "preview", id, ...(await res.json().catch(() => ({}))) });
    setBusy(null);
  }
  async function send(id: string) {
    if (!confirm("Commit this sample? This locks the questions for those mumineen (they won't be re-asked).")) return;
    setBusy(id);
    const res = await apiFetch(`/api/admin/surveys/forms/${id}/send`, { method: "POST" });
    setDetail({ kind: "send", id, ...(await res.json().catch(() => ({}))) });
    setBusy(null);
    reload();
  }
  async function results(id: string) {
    setBusy(id);
    const res = await apiFetch(`/api/admin/surveys/forms/${id}/results`);
    setDetail({ kind: "results", id, ...(await res.json().catch(() => ({}))) });
    setBusy(null);
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
            <div className="flex gap-2">
              <button onClick={() => preview(f.id)} disabled={busy === f.id} className={ghostBtn}>Preview sample</button>
              <button onClick={() => send(f.id)} disabled={busy === f.id || f.status === "sent"} className="rounded bg-emerald-600 px-3 py-1 text-xs text-white disabled:opacity-50">
                {f.status === "sent" ? "Sent" : "Commit & send"}
              </button>
              <button onClick={() => results(f.id)} disabled={busy === f.id} className={ghostBtn}>Results</button>
            </div>
          </div>
          {detail && detail.id === f.id && (
            <pre className="mt-3 max-h-80 overflow-auto rounded bg-gray-900 p-3 text-[11px] leading-relaxed text-gray-100 dark:bg-black/40">
              {JSON.stringify(detail, null, 2)}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}
