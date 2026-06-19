"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import type { RuleGroupTypeIC } from "react-querybuilder";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { apiFetch, readAdminUser } from "@/lib/admin/client";
import BroadcastHistory from "@/components/admin/niyaz/BroadcastHistory";
import { AudienceFilterBuilder } from "@/components/admin/AudienceFilterBuilder";
import { AnalyticsTab } from "@/components/admin/surveys/AnalyticsTab";

type Question = {
  id: string; section_id: string; text: string; type: string; is_general: boolean;
  options?: { label: string; score?: number }[] | null;
  negative_values?: string[] | null;
  polarity?: "positive" | "negative" | null;
  collect_comment?: boolean;
  comment_threshold?: number | null;
  required?: boolean;
};
type Section = { id: string; title: string; area: string; is_general: boolean; questions: Question[] };
type Group = { id: string; name: string; description: string | null; area_focus: string | null };
type FormRow = {
  id: string; title: string; public_title: string | null; group_name: string | null; group_id: string | null; rules: RuleGroupTypeIC | null;
  tags: string[]; sample_size: number;
  status: string; event_date: string | null; recipient_count: number; completed_count: number;
};

type Tab = "compose" | "databank" | "forms" | "lookup" | "sends" | "analytics";

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
  const [publicTitle, setPublicTitle] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [groupId, setGroupId] = useState("");
  const [targetMode, setTargetMode] = useState<"group" | "custom">("group");
  // Independent-combinators query (no top-level combinator) so AND/OR can be mixed per junction.
  const [customRules, setCustomRules] = useState<RuleGroupTypeIC>({ rules: [] } as RuleGroupTypeIC);
  const [sampleSize, setSampleSize] = useState(40);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lookupIts, setLookupIts] = useState<string | null>(null);
  const [personIts, setPersonIts] = useState<string | null>(null);

  // Clicking a sampled record opens a details popup (personal + registration info).
  function openMumin(its: string) { setPersonIts(its); }

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
  // Toggle every question in a section: select all if any are unselected, otherwise clear them.
  function toggleSection(section: Section) {
    const ids = section.questions.map((q) => q.id);
    setSelected((s) => {
      const allOn = ids.length > 0 && ids.every((id) => s.has(id));
      const n = new Set(s);
      if (allOn) ids.forEach((id) => n.delete(id));
      else ids.forEach((id) => n.add(id));
      return n;
    });
  }

  async function createForm() {
    setMsg(null);
    const useCustom = targetMode === "custom";
    if (!title.trim() || selected.size === 0) { setMsg("Pick a title and at least one question."); return; }
    if (useCustom && customRules.rules.length === 0) { setMsg("Add at least one rule to the custom filter (or switch to a saved group)."); return; }
    if (!useCustom && !groupId) { setMsg("Pick a target group (or switch to a custom filter)."); return; }
    const target = useCustom ? { rules: customRules } : { group_id: groupId };
    const tags = tagsInput.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 12);
    const res = await apiFetch("/api/admin/surveys/forms", {
      method: "POST",
      body: JSON.stringify({ title: title.trim(), public_title: publicTitle.trim() || undefined, tags, ...target, sample_size: sampleSize, question_ids: [...selected] }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { setMsg(json.error ?? "Failed to create form"); return; }
    setMsg(`Form created with ${json.question_count} questions.`);
    setTitle(""); setPublicTitle(""); setTagsInput(""); setSelected(new Set()); setCustomRules({ rules: [] } as RuleGroupTypeIC);
    await loadForms();
    setTab("forms");
  }

  // Duplicate a form into the Compose tab: prefill its questions, title (+" (copy)"), tags, sample
  // size, and target — so you reconcile (change the audience, tweak questions) and create quickly.
  async function duplicateForm(f: FormRow) {
    const res = await apiFetch(`/api/admin/surveys/forms/${f.id}/questions`);
    const json = await res.json().catch(() => ({}));
    const dbIds = new Set(sections.flatMap((s) => s.questions.map((q) => q.id)));
    const qids = ((json.questions ?? []) as { question_id: string | null }[])
      .map((q) => q.question_id)
      .filter((id): id is string => Boolean(id) && dbIds.has(id as string));
    const dropped = ((json.questions ?? []) as unknown[]).length - qids.length;
    setSelected(new Set(qids));
    setTitle(`${f.title} (copy)`);
    setTagsInput((f.tags ?? []).join(", "));
    setSampleSize(f.sample_size);
    if (f.group_id) { setTargetMode("group"); setGroupId(f.group_id); }
    else if (f.rules) { setTargetMode("custom"); setCustomRules(f.rules); }
    else { setTargetMode("group"); setGroupId(""); }
    setTab("compose");
    setMsg(`Duplicated “${f.title}” — change the target audience / questions, then Create form.${dropped ? ` (${dropped} retired question${dropped === 1 ? "" : "s"} skipped.)` : ""}`);
  }

  if (!ready) return null;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="mb-1 text-xl font-bold text-gray-900 dark:text-gray-100">Feedback Surveys</h1>
      <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">Compose targeted surveys, sample a group, and review section sentiment.</p>

      <div className="mb-5 flex gap-1 border-b border-gray-200 dark:border-gray-700">
        {(["compose", "forms", "analytics", "lookup", "sends", "databank"] as Tab[]).map((t) => (
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
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Internal title (admin only, e.g. Flow — Day 3)" className={`${inputCls} sm:col-span-2`} />
            <input type="number" value={sampleSize} min={1} onChange={(e) => setSampleSize(parseInt(e.target.value || "0", 10))} placeholder="Sample size" className={inputCls} />
          </div>
          <input value={publicTitle} onChange={(e) => setPublicTitle(e.target.value)} placeholder="Title recipients see on the form (e.g. Ashara Mubaraka — Daily Feedback)" className={`w-full ${inputCls}`} />
          <input value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} placeholder="Tags (comma-separated, e.g. rahat, day-2) — to tell same-named forms apart" className={`w-full ${inputCls}`} />
          <div className="space-y-2">
            <div className="inline-flex rounded-lg border border-gray-200 p-0.5 text-xs dark:border-gray-700">
              <button onClick={() => setTargetMode("group")} className={`rounded-md px-3 py-1 font-medium ${targetMode === "group" ? "bg-blue-600 text-white" : "text-gray-500 dark:text-gray-400"}`}>Saved group</button>
              <button onClick={() => setTargetMode("custom")} className={`rounded-md px-3 py-1 font-medium ${targetMode === "custom" ? "bg-blue-600 text-white" : "text-gray-500 dark:text-gray-400"}`}>Custom filter</button>
            </div>
            {targetMode === "group" ? (
              <select value={groupId} onChange={(e) => setGroupId(e.target.value)} className={`w-full ${inputCls}`}>
                <option value="">— Target group —</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}{g.area_focus ? ` (${g.area_focus})` : ""}</option>)}
              </select>
            ) : (
              <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                <AudienceFilterBuilder query={customRules} onChange={setCustomRules} />
              </div>
            )}
          </div>

          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Questions ({selected.size} selected)</p>
            <button onClick={selectGeneral} className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400">+ Add all general questions</button>
          </div>
          <div className="space-y-3">
            {sections.map((s) => (
              <div key={s.id} className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
                <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-800/60">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">{s.title}</span>
                    <button onClick={() => toggleSection(s)} className="text-[11px] font-medium text-blue-600 hover:underline dark:text-blue-400">
                      {s.questions.length > 0 && s.questions.every((q) => selected.has(q.id)) ? "Clear section" : "Select all"}
                    </button>
                  </div>
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

      {tab === "forms" && <FormsTab forms={forms} reload={loadForms} onPickMumin={openMumin} onDuplicate={duplicateForm} />}

      {tab === "lookup" && <LookupTab initialIts={lookupIts} />}

      {tab === "sends" && <SendsTab />}

      {tab === "analytics" && <AnalyticsTab />}

      {tab === "databank" && (
        <div className="space-y-3">
          <AddSection onAdded={loadDatabank} />
          {sections.map((s) => (
            <div key={s.id} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
              <EditableSection s={s} onChanged={loadDatabank} />
              <SectionQuestions sectionId={s.id} questions={s.questions} onChanged={loadDatabank} />
              <AddQuestion sectionId={s.id} onAdded={loadDatabank} />
            </div>
          ))}
        </div>
      )}

      {personIts && <PersonModal its={personIts} onClose={() => setPersonIts(null)} />}
    </div>
  );
}

type PersonDetail = {
  mumin: Record<string, unknown> & { name: string | null; its: string };
  family: Record<string, unknown> | null;
};

function PersonModal({ its, onClose }: { its: string; onClose: () => void }) {
  const [data, setData] = useState<PersonDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiFetch(`/api/admin/surveys/mumin?its=${encodeURIComponent(its)}`)
      .then((r) => r.json())
      .then((j) => { if (j.error) setErr(j.error); else setData(j as PersonDetail); })
      .catch(() => setErr("Lookup failed"));
  }, [its]);

  const m = data?.mumin;
  const fam = data?.family;
  const fmtDate = (v: unknown) => (typeof v === "string" ? v.slice(0, 10) : null);
  const yes = (v: unknown) => (v ? "Yes" : "No");
  const row = (label: string, value: React.ReactNode) =>
    value == null || value === "" ? null : (
      <div className="flex justify-between gap-4 py-1 text-sm">
        <span className="text-gray-500 dark:text-gray-400">{label}</span>
        <span className="text-right font-medium text-gray-800 dark:text-gray-100">{value}</span>
      </div>
    );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-md overflow-auto rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl dark:border-gray-700 dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{m?.name ?? "Mumin details"}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-full px-2 text-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">✕</button>
        </div>
        {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}
        {!data && !err && <p className="text-sm text-gray-500">Loading…</p>}
        {m && (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {row("ITS", <span className="font-mono">{String(m.its)}</span>)}
            {row("HOF ITS", m.hof_its ? <span className="font-mono">{String(m.hof_its)}</span> : null)}
            {row("Head of family", m.is_head ? "Yes" : null)}
            {row("Gender / Age", [m.gender, m.age].filter(Boolean).join(" · ") || null)}
            {row("Jamaat", m.jamaat as React.ReactNode)}
            {row("City", m.city as React.ReactNode)}
            {row("Local / Mehman", m.local_mehman as React.ReactNode)}
            {row("Category", m.category as React.ReactNode)}
            {row("Idara", m.idara as React.ReactNode)}
            {row("Phone", m.phone as React.ReactNode)}
            {row("Email", m.email as React.ReactNode)}
            {row("Arrival", fmtDate(m.arrival_at))}
            {row("Departure", fmtDate(m.departure_at))}
            {row("Airport", m.airport as React.ReactNode)}
            {row("Rahat / Wheelchair", (m.rahat_seating || m.wheelchair) ? [m.rahat_seating ? "Rahat" : null, m.wheelchair ? "Wheelchair" : null].filter(Boolean).join(" · ") : null)}
            {row("Special needs", m.special_needs as React.ReactNode)}
            {row("Attending", m.not_attending ? "No" : "Yes")}
            {row("Registration", fam ? (fam.registration_status === "submitted" ? "Submitted" : "Not started") : "—")}
            {row("Accommodation", fam?.acc_type ? `${fam.acc_type}${fam.hotel_name ? ` — ${fam.hotel_name}` : fam.utaro_host_name ? ` — ${fam.utaro_host_name}` : ""}` : null)}
            {row("Transport", fam?.transport_mode as React.ReactNode)}
            {row("Wants khidmat", m.wants_khidmat ? yes(m.wants_khidmat) : null)}
          </div>
        )}
      </div>
    </div>
  );
}

const QUAL_OPTS = [{ label: "Excellent" }, { label: "Good" }, { label: "Fair" }, { label: "Poor" }];

// Turn a "one option per line" textarea + a comma-list of negative labels into scored options.
// Options are ordered best→worst (position scoring 5→1); any label marked negative is forced to a
// low score AND added to negative_values (so it counts as a problem and opens the comment box).
function parseChoiceOptions(optionsText: string, negText: string): { options: { label: string; score: number }[]; negative_values: string[] } | null {
  const labels = optionsText.split("\n").map((s) => s.trim()).filter(Boolean);
  if (labels.length < 2) return null;
  const negs = new Set(negText.split(",").map((s) => s.trim()).filter(Boolean));
  const n = labels.length;
  const options = labels.map((label, i) => ({
    label,
    score: negs.has(label) ? 1 : Math.max(1, Math.min(5, Math.round(5 - (i / Math.max(1, n - 1)) * 4))),
  }));
  return { options, negative_values: labels.filter((l) => negs.has(l)) };
}

function EditableQuestion({ q, onChanged, onMoveUp, onMoveDown }: { q: Question; onChanged: () => void; onMoveUp?: () => void; onMoveDown?: () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(q.text);
  const [type, setType] = useState(q.type);
  const [isGeneral, setIsGeneral] = useState(q.is_general);
  const [polarity, setPolarity] = useState<"positive" | "negative">(q.polarity ?? "positive");
  const [collectComment, setCollectComment] = useState(q.collect_comment ?? true);
  const [threshold, setThreshold] = useState(q.comment_threshold != null ? String(q.comment_threshold) : "");
  const [required, setRequired] = useState(q.required ?? false);
  const [optionsText, setOptionsText] = useState((q.options ?? []).map((o) => o.label).join("\n"));
  const [negText, setNegText] = useState((q.negative_values ?? []).join(", "));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function reset() {
    setText(q.text); setType(q.type); setIsGeneral(q.is_general); setPolarity(q.polarity ?? "positive");
    setCollectComment(q.collect_comment ?? true); setThreshold(q.comment_threshold != null ? String(q.comment_threshold) : "");
    setRequired(q.required ?? false);
    setOptionsText((q.options ?? []).map((o) => o.label).join("\n")); setNegText((q.negative_values ?? []).join(", "));
    setErr(null);
  }

  async function save() {
    setErr(null);
    const patch: Record<string, unknown> = { text: text.trim(), type, is_general: isGeneral, polarity, collect_comment: collectComment, required };
    if (type === "choice") {
      if (optionsText.trim()) {
        const parsed = parseChoiceOptions(optionsText, negText);
        if (!parsed) { setErr("Enter at least 2 options (one per line)."); return; }
        patch.options = parsed.options; patch.negative_values = parsed.negative_values;
      } else if (!q.options || q.options.length < 2) { patch.options = QUAL_OPTS; patch.negative_values = ["Fair", "Poor"]; }
    } else if (type === "yesno") {
      patch.negative_values = polarity === "negative" ? ["Yes"] : ["No"];
    }
    if (type === "scale10" || type === "scale5") {
      patch.comment_threshold = threshold.trim() ? parseInt(threshold, 10) : null;
    }
    setSaving(true);
    const res = await apiFetch(`/api/admin/surveys/questions/${q.id}`, { method: "PATCH", body: JSON.stringify(patch) });
    setSaving(false);
    if (res.ok) { setEditing(false); onChanged(); }
    else setErr((await res.json().catch(() => ({}))).error ?? "Failed to save");
  }
  async function remove() {
    if (!confirm("Remove this question from the databank? Existing forms keep it; it won't appear in new forms.")) return;
    await apiFetch(`/api/admin/surveys/questions/${q.id}`, { method: "DELETE" });
    onChanged();
  }

  if (editing) {
    const small = "rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100";
    const isScale = type === "scale10" || type === "scale5";
    return (
      <li className="space-y-2 rounded-md border border-blue-200 p-2 dark:border-blue-900">
        <div className="flex flex-wrap items-center gap-2">
          <input value={text} onChange={(e) => setText(e.target.value)} className={`min-w-[14rem] flex-1 ${small}`} />
          <select value={type} onChange={(e) => setType(e.target.value)} className={small}>
            <option value="yesno">Yes/No</option><option value="choice">Choice</option>
            <option value="scale10">Scale 1-10</option><option value="scale5">Scale 1-5</option><option value="text">Text</option>
          </select>
          {(type === "yesno" || isScale) && (
            <select value={polarity} onChange={(e) => setPolarity(e.target.value as "positive" | "negative")} className={small} title="How the answer scores">
              <option value="positive">higher = better</option><option value="negative">inverted (yes = worse)</option>
            </select>
          )}
          <label className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300"><input type="checkbox" checked={isGeneral} onChange={(e) => setIsGeneral(e.target.checked)} className="accent-blue-600" /> general</label>
          <label className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300" title="Respondents must answer this question before submitting."><input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} className="accent-blue-600" /> required</label>
        </div>
        {type === "choice" && (
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[11px] text-gray-500 dark:text-gray-400">Options — one per line, best → worst</label>
              <textarea value={optionsText} onChange={(e) => setOptionsText(e.target.value)} rows={3} placeholder={"Excellent\nGood\nFair\nPoor"} className={`w-full ${small}`} />
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-gray-500 dark:text-gray-400">Problem options (comma-separated) — open the comment box & score low</label>
              <input value={negText} onChange={(e) => setNegText(e.target.value)} placeholder="Fair, Poor" className={`w-full ${small}`} />
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300" title="When off, this question never asks for a 'why?' comment.">
            <input type="checkbox" checked={collectComment} onChange={(e) => setCollectComment(e.target.checked)} className="accent-blue-600" /> Ask for a comment on negative answers
          </label>
          {isScale && collectComment && (
            <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300" title={`Ratings at or below this open the comment box (default ${type === "scale10" ? 6 : 3}).`}>
              Comment when rating ≤
              <input type="number" min={1} max={type === "scale10" ? 10 : 5} value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder={type === "scale10" ? "6" : "3"} className={`w-16 ${small}`} />
            </label>
          )}
        </div>
        {err && <p className="text-xs text-red-500 dark:text-red-400">{err}</p>}
        <div className="flex items-center gap-2">
          <button onClick={save} disabled={saving || text.trim().length < 3} className="rounded bg-blue-600 px-2 py-1 text-xs text-white disabled:opacity-50">Save</button>
          <button onClick={() => { reset(); setEditing(false); }} className="text-xs text-gray-500 hover:underline dark:text-gray-400">Cancel</button>
        </div>
      </li>
    );
  }

  return (
    <li className="group flex items-start justify-between gap-3">
      <span className="leading-snug"><span className="text-gray-400">•</span> {q.text}{q.required ? <span className="text-red-500" title="Required">*</span> : null} <span className="text-[10px] uppercase text-gray-400">({q.type})</span>{q.collect_comment === false ? <span className="text-[10px] text-gray-400"> · no comment</span> : (q.comment_threshold != null ? <span className="text-[10px] text-gray-400"> · comment ≤ {q.comment_threshold}</span> : null)}</span>
      <span className="flex flex-shrink-0 items-center gap-2 opacity-0 focus-within:opacity-100 group-hover:opacity-100">
        <button onClick={onMoveUp} disabled={!onMoveUp} title="Move up" className="text-xs text-gray-400 hover:text-gray-700 disabled:opacity-30 dark:hover:text-gray-200">↑</button>
        <button onClick={onMoveDown} disabled={!onMoveDown} title="Move down" className="text-xs text-gray-400 hover:text-gray-700 disabled:opacity-30 dark:hover:text-gray-200">↓</button>
        <button onClick={() => setEditing(true)} className="text-xs text-blue-500 hover:underline dark:text-blue-400">Edit</button>
        <button onClick={remove} className="text-xs text-red-500 hover:underline dark:text-red-400">Remove</button>
      </span>
    </li>
  );
}

// Renders a section's questions in order with ↑/↓ controls. Reordering optimistically updates the
// local order, persists it via the reorder endpoint, then refreshes the databank.
function SectionQuestions({ sectionId, questions, onChanged }: { sectionId: string; questions: Question[]; onChanged: () => void }) {
  const [order, setOrder] = useState<Question[]>(questions);
  // Keep local order in sync when the databank reloads (add/edit/delete elsewhere).
  useEffect(() => { setOrder(questions); }, [questions]);

  async function move(index: number, dir: -1 | 1) {
    const next = [...order];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setOrder(next);
    const res = await apiFetch("/api/admin/surveys/questions/reorder", {
      method: "POST",
      body: JSON.stringify({ section_id: sectionId, ordered_ids: next.map((q) => q.id) }),
    });
    if (res.ok) onChanged();
    else setOrder(questions); // revert on failure
  }

  return (
    <ul className="mt-1 space-y-0.5 text-sm text-gray-600 dark:text-gray-300">
      {order.map((q, i) => (
        <EditableQuestion
          key={q.id}
          q={q}
          onChanged={onChanged}
          onMoveUp={i > 0 ? () => move(i, -1) : undefined}
          onMoveDown={i < order.length - 1 ? () => move(i, 1) : undefined}
        />
      ))}
    </ul>
  );
}

// Feedback areas a section can map to (drives department routing). Kept in sync with
// FEEDBACK_AREAS in src/lib/feedback/areas.ts — duplicated here because that module is server-only.
const AREAS = ["general", "mawaid", "flow", "parking_transport", "audio_video", "accommodation", "seating"] as const;

// Section header in the Databank tab: inline-edit the name/area/general flag, or delete the whole
// section (soft-delete — already-composed forms keep working off their snapshots).
function EditableSection({ s, onChanged }: { s: Section; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(s.title);
  const [area, setArea] = useState(s.area);
  const [isGeneral, setIsGeneral] = useState(s.is_general);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const res = await apiFetch(`/api/admin/surveys/sections/${s.id}`, {
      method: "PATCH",
      body: JSON.stringify({ title: title.trim(), area, is_general: isGeneral }),
    });
    setSaving(false);
    if (res.ok) { setEditing(false); onChanged(); }
  }
  async function remove() {
    if (!confirm(`Delete the "${s.title}" section and its ${s.questions.length} question(s)? Already-sent forms keep working; it won't appear in new forms.`)) return;
    await apiFetch(`/api/admin/surveys/sections/${s.id}`, { method: "DELETE" });
    onChanged();
  }

  const small = "rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100";
  if (editing) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <input value={title} onChange={(e) => setTitle(e.target.value)} className={`min-w-[14rem] flex-1 ${small}`} />
        <select value={area} onChange={(e) => setArea(e.target.value)} className={small}>
          {AREAS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <label className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300"><input type="checkbox" checked={isGeneral} onChange={(e) => setIsGeneral(e.target.checked)} className="accent-blue-600" /> general</label>
        <button onClick={save} disabled={saving || title.trim().length < 3} className="rounded bg-blue-600 px-2 py-1 text-xs text-white disabled:opacity-50">Save</button>
        <button onClick={() => { setTitle(s.title); setArea(s.area); setIsGeneral(s.is_general); setEditing(false); }} className="text-xs text-gray-500 hover:underline dark:text-gray-400">Cancel</button>
      </div>
    );
  }
  return (
    <div className="group flex items-center justify-between gap-3">
      <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{s.title} <span className="text-[11px] uppercase text-gray-400 dark:text-gray-500">{s.area}{s.is_general ? " · general" : ""}</span></p>
      <span className="flex flex-shrink-0 gap-2 opacity-0 focus-within:opacity-100 group-hover:opacity-100">
        <button onClick={() => setEditing(true)} className="text-xs text-blue-500 hover:underline dark:text-blue-400">Edit</button>
        <button onClick={remove} className="text-xs text-red-500 hover:underline dark:text-red-400">Delete</button>
      </span>
    </div>
  );
}

function AddSection({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [area, setArea] = useState<string>("general");
  const [isGeneral, setIsGeneral] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function add() {
    setErr(null);
    setSaving(true);
    const res = await apiFetch("/api/admin/surveys/sections", {
      method: "POST",
      body: JSON.stringify({ title: title.trim(), area, is_general: isGeneral }),
    });
    setSaving(false);
    if (res.ok) { setTitle(""); setArea("general"); setIsGeneral(false); setOpen(false); onAdded(); }
    else setErr((await res.json().catch(() => ({}))).error ?? "Failed to add");
  }

  if (!open) return <button onClick={() => setOpen(true)} className="rounded border border-dashed border-gray-300 px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-gray-50 dark:border-gray-600 dark:text-blue-400 dark:hover:bg-gray-800">+ Add section</button>;
  return (
    <div className="rounded-lg border border-blue-200 p-3 dark:border-blue-900">
      <div className="flex flex-wrap items-center gap-2">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Section name" className={`min-w-[14rem] flex-1 ${inputCls}`} />
        <select value={area} onChange={(e) => setArea(e.target.value)} className={inputCls}>
          {AREAS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <label className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300"><input type="checkbox" checked={isGeneral} onChange={(e) => setIsGeneral(e.target.checked)} className="accent-blue-600" /> general (asked of everyone)</label>
        <button onClick={add} disabled={saving || title.trim().length < 3} className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-50">Add</button>
        <button onClick={() => { setOpen(false); setErr(null); }} className="text-xs text-gray-500 hover:underline dark:text-gray-400">Cancel</button>
      </div>
      {err && <p className="mt-1 text-xs text-red-500 dark:text-red-400">{err}</p>}
    </div>
  );
}

function AddQuestion({ sectionId, onAdded }: { sectionId: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [type, setType] = useState("yesno");
  const [optionsText, setOptionsText] = useState("");
  const [negText, setNegText] = useState("");
  const [collectComment, setCollectComment] = useState(true);
  const [threshold, setThreshold] = useState("");
  const [required, setRequired] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isScale = type === "scale10" || type === "scale5";

  async function add() {
    setErr(null);
    const body: Record<string, unknown> = { section_id: sectionId, text: text.trim(), type, collect_comment: collectComment, required };
    if (type === "choice") {
      if (optionsText.trim()) {
        const parsed = parseChoiceOptions(optionsText, negText);
        if (!parsed) { setErr("Enter at least 2 options (one per line)."); return; }
        body.options = parsed.options;
        body.negative_values = parsed.negative_values;
      } else {
        body.options = QUAL_OPTS; // default to Excellent/Good/Fair/Poor
        body.negative_values = ["Fair", "Poor"];
      }
    }
    if (isScale && threshold.trim()) body.comment_threshold = parseInt(threshold, 10);
    setSaving(true);
    const res = await apiFetch("/api/admin/surveys/questions", { method: "POST", body: JSON.stringify(body) });
    setSaving(false);
    if (res.ok) { setText(""); setOptionsText(""); setNegText(""); setThreshold(""); setCollectComment(true); setRequired(false); setOpen(false); onAdded(); }
    else setErr((await res.json().catch(() => ({}))).error ?? "Failed to add");
  }

  if (!open) return <button onClick={() => setOpen(true)} className="mt-2 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400">+ Add question</button>;
  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Question text" className={`flex-1 ${inputCls}`} />
        <select value={type} onChange={(e) => setType(e.target.value)} className={inputCls}>
          <option value="yesno">Yes/No</option><option value="choice">Choice</option>
          <option value="scale10">Scale 1-10</option><option value="scale5">Scale 1-5</option><option value="text">Text</option>
        </select>
      </div>
      {type === "choice" && (
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-[11px] text-gray-500 dark:text-gray-400">Options — one per line, best → worst (blank = Excellent/Good/Fair/Poor)</label>
            <textarea value={optionsText} onChange={(e) => setOptionsText(e.target.value)} rows={3} placeholder={"Just right\nToo hot\nToo cold"} className={`w-full ${inputCls}`} />
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-gray-500 dark:text-gray-400">Problem options (comma-separated) — open the comment box & score low</label>
            <input value={negText} onChange={(e) => setNegText(e.target.value)} placeholder="Too hot, Too cold" className={`w-full ${inputCls}`} />
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300" title="Respondents must answer this question before submitting.">
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} className="accent-blue-600" /> Required
        </label>
        <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300" title="When off, this question never asks for a 'why?' comment.">
          <input type="checkbox" checked={collectComment} onChange={(e) => setCollectComment(e.target.checked)} className="accent-blue-600" /> Ask for a comment on negative answers
        </label>
        {isScale && collectComment && (
          <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300" title={`Ratings at or below this open the comment box (default ${type === "scale10" ? 6 : 3}).`}>
            Comment when rating ≤
            <input type="number" min={1} max={type === "scale10" ? 10 : 5} value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder={type === "scale10" ? "6" : "3"} className={`w-16 ${inputCls}`} />
          </label>
        )}
      </div>
      {err && <p className="text-xs text-red-500 dark:text-red-400">{err}</p>}
      <div className="flex items-center gap-2">
        <button onClick={add} disabled={saving || text.trim().length < 3} className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-50">Add</button>
        <button onClick={() => { setOpen(false); setErr(null); }} className="text-xs text-gray-500 hover:underline dark:text-gray-400">Cancel</button>
      </div>
    </div>
  );
}

type Detail = { kind: string; id: string; [k: string]: unknown };

type Template = { name: string; language: string; displayNumber?: string | null; accountLabel?: string; urlButtons?: { hasVar: boolean }[]; bodyVars?: string[] };

function FormsTab({ forms, reload, onPickMumin, onDuplicate }: { forms: FormRow[]; reload: () => void; onPickMumin: (its: string) => void; onDuplicate: (f: FormRow) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [questionsFor, setQuestionsFor] = useState<string | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateCode, setTemplateCode] = useState("");
  const [freeWindow, setFreeWindow] = useState(false);
  const [excludeSent, setExcludeSent] = useState(false);

  // Approved WhatsApp templates that have a dynamic URL button (needed to carry the survey link).
  useEffect(() => {
    apiFetch("/api/admin/whatsapp/templates")
      .then((r) => r.json())
      .then((j) => setTemplates(((j.templates ?? []) as Template[]).filter((t) => (t.urlButtons ?? []).some((b) => b.hasVar))))
      .catch(() => setTemplates([]));
  }, []);

  async function call(id: string, kind: string, path: string, method = "GET") {
    setBusy(id);
    const res = await apiFetch(path, method === "GET" ? undefined : { method });
    setDetail({ kind, id, ...(await res.json().catch(() => ({}))) });
    setBusy(null);
  }
  async function preview(id: string) {
    setBusy(id);
    const res = await apiFetch(`/api/admin/surveys/forms/${id}/preview`, { method: "POST", body: JSON.stringify({ freeWindowOnly: freeWindow, excludeAlreadySent: excludeSent }) });
    setDetail({ kind: "preview", id, freeWindow, ...(await res.json().catch(() => ({}))) });
    setBusy(null);
  }
  async function send(id: string, status?: string) {
    const already = status === "sampled";
    const msg = already
      ? `Send the already-committed links for this form via WhatsApp?${templateCode ? "" : "\n\nNo template is selected — without one this just shows the links to copy."}`
      : `Commit this sample${freeWindow ? " (free-window only)" : ""}? This locks the questions for those mumineen (they won't be re-asked).`;
    if (!confirm(msg)) return;
    setBusy(id);
    const res = await apiFetch(`/api/admin/surveys/forms/${id}/send`, {
      method: "POST",
      body: JSON.stringify({ template: templateCode || undefined, freeWindowOnly: freeWindow, excludeAlreadySent: excludeSent }),
    });
    setDetail({ kind: "send", id, ...(await res.json().catch(() => ({}))) });
    setBusy(null);
    reload();
  }
  async function results(id: string, includeTest: boolean) {
    setBusy(id);
    const res = await apiFetch(`/api/admin/surveys/forms/${id}/results${includeTest ? "?includeTest=1" : ""}`);
    setDetail({ kind: "results", id, ...(await res.json().catch(() => ({}))) });
    setBusy(null);
  }
  // Toggle: open results, or collapse them if already showing for this form.
  function toggleResults(id: string) {
    if (detail?.kind === "results" && detail.id === id) { setDetail(null); return; }
    void results(id, false);
  }
  async function testLink(id: string) {
    const its = window.prompt("Send test to which ITS? (leave blank for an anonymous 'you' preview link):", "")?.trim() ?? "";
    let deliver = false;
    if (its) {
      deliver = confirm("Deliver this test to that person's WhatsApp now?\n\nOK  = send to their WhatsApp (uses the selected template)\nCancel = just generate their link to copy / forward");
    }
    setBusy(id);
    const res = await apiFetch(`/api/admin/surveys/forms/${id}/test-link`, {
      method: "POST",
      body: JSON.stringify({ ...(its ? { its } : {}), deliver, template: templateCode || undefined }),
    });
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
      <div className="mb-1 flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 p-2 dark:border-gray-700">
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">WhatsApp template:</span>
        <select value={templateCode} onChange={(e) => setTemplateCode(e.target.value)} className={inputCls}>
          <option value="">— Manual links only (no WhatsApp send) —</option>
          {templates.map((t) => (
            <option key={`${t.name}:${t.language}`} value={t.name}>
              {t.name}{t.displayNumber ? ` · ${t.displayNumber}` : ""}{(t.bodyVars?.length ?? 0) > 1 ? ` · ${t.bodyVars?.length} body vars` : ""}
            </option>
          ))}
        </select>
        {templates.length === 0 && <span className="text-xs text-amber-600 dark:text-amber-400">No approved URL-button templates found.</span>}
        {templateCode && <span className="text-xs text-emerald-600 dark:text-emerald-400">Commit &amp; send (and Test deliver) will use this template.</span>}
        <label className="ml-auto flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300" title="Only sample people who messaged us in the last 24h, so the template send is free (no paid quota).">
          <input type="checkbox" checked={freeWindow} onChange={(e) => setFreeWindow(e.target.checked)} className="accent-emerald-600" />
          Free-window only (no quota cost)
        </label>
        <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300" title="Skip anyone who's already been sent ANY survey this event — avoids re-surveying people a previous form already reached.">
          <input type="checkbox" checked={excludeSent} onChange={(e) => setExcludeSent(e.target.checked)} className="accent-emerald-600" />
          Exclude already-surveyed
        </label>
      </div>
      {forms.length === 0 && <p className="text-sm text-gray-500 dark:text-gray-400">No forms yet — compose one.</p>}
      {forms.map((f) => (
        <div key={f.id} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
          <div className="space-y-2">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{f.title}</p>
                <TagsEditor formId={f.id} tags={f.tags ?? []} reload={reload} />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {f.group_name ?? "—"} · status {f.status} · {f.completed_count}/{f.recipient_count} responded · sample <SampleSizeEditor formId={f.id} value={f.sample_size} reload={reload} />
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Recipients see: <PublicTitleEditor formId={f.id} value={f.public_title} reload={reload} /></p>
            </div>
            <div className="flex flex-wrap gap-2">
              {/* A sent form is locked in — only "Test to people" and "Results" are relevant; the
                  pre-send actions (test link, preview, commit, delete) are hidden to prevent mistakes. */}
              {f.status !== "sent" && <button onClick={() => testLink(f.id)} disabled={busy === f.id} className={ghostBtn}>Test link</button>}
              <button onClick={() => setPickerFor(pickerFor === f.id ? null : f.id)} className={ghostBtn}>Test to people</button>
              {f.status !== "sent" && <button onClick={() => preview(f.id)} disabled={busy === f.id} className={ghostBtn}>Preview sample</button>}
              {f.status !== "sent" && (
                <button onClick={() => send(f.id, f.status)} disabled={busy === f.id} className="rounded bg-emerald-600 px-3 py-1 text-xs text-white disabled:opacity-50">
                  {f.status === "sampled" ? "Send committed" : "Commit & send"}
                </button>
              )}
              <button onClick={() => setQuestionsFor(questionsFor === f.id ? null : f.id)} className={`${ghostBtn} ${questionsFor === f.id ? "bg-gray-100 dark:bg-gray-800" : ""}`}>
                {questionsFor === f.id ? "Hide questions" : "Questions"}
              </button>
              <button onClick={() => toggleResults(f.id)} disabled={busy === f.id} className={`${ghostBtn} ${detail?.kind === "results" && detail.id === f.id ? "bg-gray-100 dark:bg-gray-800" : ""}`}>
                {detail?.kind === "results" && detail.id === f.id ? "Hide results" : "Results"}
              </button>
              <button onClick={() => onDuplicate(f)} disabled={busy === f.id} className={ghostBtn} title="Copy this form's questions into Compose to create a new one (e.g. for a different audience)">Duplicate</button>
              {f.status !== "sent" && <button onClick={() => del(f.id)} disabled={busy === f.id} className="rounded border border-red-300 px-3 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40">Delete</button>}
            </div>
          </div>
          {pickerFor === f.id && <ManualTestPanel formId={f.id} templateCode={templateCode} />}
          {questionsFor === f.id && <FormQuestionsPanel formId={f.id} editable={f.status !== "sent"} reload={reload} />}
          {detail && detail.id === f.id && <DetailView detail={detail} onPickMumin={onPickMumin} onResultsToggleTest={(inc) => results(f.id, inc)} onClose={() => setDetail(null)} />}
        </div>
      ))}
    </div>
  );
}

// Inline-editable sample size in a form row. Click the number to edit; Enter/blur saves via PATCH.
function SampleSizeEditor({ formId, value, reload }: { formId: string; value: number; reload: () => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(value));
  const [saving, setSaving] = useState(false);

  async function save() {
    const n = parseInt(val, 10);
    if (!Number.isFinite(n) || n < 1) { setVal(String(value)); setEditing(false); return; }
    if (n === value) { setEditing(false); return; }
    setSaving(true);
    const res = await apiFetch(`/api/admin/surveys/forms/${formId}`, { method: "PATCH", body: JSON.stringify({ sample_size: n }) });
    setSaving(false);
    setEditing(false);
    if (res.ok) reload();
    else setVal(String(value));
  }

  if (!editing) {
    return (
      <button onClick={() => { setVal(String(value)); setEditing(true); }} className="font-medium text-blue-600 underline decoration-dotted underline-offset-2 hover:text-blue-700 dark:text-blue-400" title="Edit sample size">
        {value}
      </button>
    );
  }
  return (
    <input
      type="number"
      min={1}
      autoFocus
      value={val}
      disabled={saving}
      onChange={(e) => setVal(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => { if (e.key === "Enter") save(); else if (e.key === "Escape") { setVal(String(value)); setEditing(false); } }}
      className="w-16 rounded border border-gray-300 bg-white px-1.5 py-0.5 text-xs text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
    />
  );
}

// Inline tag chips + editor for a form row. Tags identify forms that share a title but target
// different audiences (e.g. "rahat", "mehman"). Click to edit a comma-separated list.
// The recipient-facing header title (what mumineen see on the form). Distinct from the internal
// admin label. Blank → recipients see the generic default "Mumineen Feedback".
function PublicTitleEditor({ formId, value, reload }: { formId: string; value: string | null; reload: () => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    const next = val.trim();
    setSaving(true);
    const res = await apiFetch(`/api/admin/surveys/forms/${formId}`, { method: "PATCH", body: JSON.stringify({ public_title: next || null }) });
    setSaving(false);
    setEditing(false);
    if (res.ok) reload(); else setVal(value ?? "");
  }

  if (editing) {
    return (
      <input
        autoFocus value={val} disabled={saving}
        onChange={(e) => setVal(e.target.value)} onBlur={save}
        onKeyDown={(e) => { if (e.key === "Enter") save(); else if (e.key === "Escape") { setVal(value ?? ""); setEditing(false); } }}
        placeholder="e.g. Ashara Mubaraka — Daily Feedback"
        className="w-72 rounded border border-gray-300 bg-white px-1.5 py-0.5 text-xs text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
      />
    );
  }
  return (
    <button onClick={() => { setVal(value ?? ""); setEditing(true); }} className="font-medium text-blue-600 underline decoration-dotted underline-offset-2 hover:text-blue-700 dark:text-blue-400" title="Edit the title recipients see">
      {value || "“Mumineen Feedback” (set a title)"}
    </button>
  );
}

function TagsEditor({ formId, tags, reload }: { formId: string; tags: string[]; reload: () => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(tags.join(", "));
  const [saving, setSaving] = useState(false);

  async function save() {
    const next = val.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 12);
    setSaving(true);
    const res = await apiFetch(`/api/admin/surveys/forms/${formId}`, { method: "PATCH", body: JSON.stringify({ tags: next }) });
    setSaving(false);
    setEditing(false);
    if (res.ok) reload(); else setVal(tags.join(", "));
  }

  if (editing) {
    return (
      <input
        autoFocus value={val} disabled={saving}
        onChange={(e) => setVal(e.target.value)} onBlur={save}
        onKeyDown={(e) => { if (e.key === "Enter") save(); else if (e.key === "Escape") { setVal(tags.join(", ")); setEditing(false); } }}
        placeholder="tags, comma-separated"
        className="w-48 rounded border border-gray-300 bg-white px-1.5 py-0.5 text-xs text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
      />
    );
  }
  return (
    <button onClick={() => { setVal(tags.join(", ")); setEditing(true); }} className="flex items-center gap-1" title="Edit tags">
      {tags.length === 0 ? (
        <span className="text-xs text-blue-600 hover:underline dark:text-blue-400">+ tag</span>
      ) : (
        tags.map((t) => <span key={t} className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">{t}</span>)
      )}
    </button>
  );
}

// A composed question on a form (snapshot copy).
type FormQ = {
  id: string; question_id: string | null; section_id: string | null; area: string | null;
  snapshot: {
    text: string; type: string;
    options?: { label: string; score?: number }[] | null;
    negative_values?: string[] | null;
    polarity?: "positive" | "negative" | null;
    comment_threshold?: number | null;
    collect_comment?: boolean;
    required?: boolean;
    section_title?: string | null;
  };
};

// Panel under a form row: review the form's composed questions (grouped by section) and, for a
// not-yet-sent form, edit each one on the fly (text / required / comment box / options) or remove it.
// Edits apply only to this form's snapshot — the databank is untouched.
function FormQuestionsPanel({ formId, editable, reload }: { formId: string; editable: boolean; reload: () => void }) {
  const [items, setItems] = useState<FormQ[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await apiFetch(`/api/admin/surveys/forms/${formId}/questions`);
    const json = await res.json().catch(() => ({}));
    setItems((json.questions as FormQ[]) ?? []);
    setLoading(false);
  }, [formId]);
  useEffect(() => { void load(); }, [load]);

  function onChanged() { void load(); reload(); }

  const box = "mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/40";
  if (loading) return <div className={box}><p className="text-xs text-gray-500 dark:text-gray-400">Loading questions…</p></div>;
  if (items.length === 0) return <div className={box}><p className="text-xs text-gray-500 dark:text-gray-400">No questions composed.</p></div>;

  // Group by section for readability (preserving order).
  const groups: { title: string; rows: FormQ[] }[] = [];
  for (const it of items) {
    const title = it.snapshot.section_title ?? "Section";
    let g = groups[groups.length - 1];
    if (!g || g.title !== title) groups.push((g = { title, rows: [] }));
    g.rows.push(it);
  }

  return (
    <div className={box}>
      <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">{items.length} question{items.length === 1 ? "" : "s"}{editable ? " · edits apply to this form only" : " · sent form (read-only)"}</p>
      {groups.map((g) => (
        <div key={g.title} className="mb-2">
          <p className="text-[11px] font-semibold uppercase text-gray-500 dark:text-gray-400">{g.title}</p>
          <ul className="mt-1 space-y-0.5 text-sm text-gray-600 dark:text-gray-300">
            {g.rows.map((fq) => <FormQuestionEditor key={fq.id} fq={fq} formId={formId} editable={editable} onChanged={onChanged} />)}
          </ul>
        </div>
      ))}
    </div>
  );
}

function FormQuestionEditor({ fq, formId, editable, onChanged }: { fq: FormQ; formId: string; editable: boolean; onChanged: () => void }) {
  const s = fq.snapshot;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(s.text);
  const [required, setRequired] = useState(s.required ?? false);
  const [collectComment, setCollectComment] = useState(s.collect_comment ?? true);
  const [threshold, setThreshold] = useState(s.comment_threshold != null ? String(s.comment_threshold) : "");
  const [optionsText, setOptionsText] = useState((s.options ?? []).map((o) => o.label).join("\n"));
  const [negText, setNegText] = useState((s.negative_values ?? []).join(", "));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isScale = s.type === "scale10" || s.type === "scale5";

  async function save() {
    setErr(null);
    const patch: Record<string, unknown> = { text: text.trim(), required, collect_comment: collectComment };
    if (s.type === "choice" && optionsText.trim()) {
      const parsed = parseChoiceOptions(optionsText, negText);
      if (!parsed) { setErr("Enter at least 2 options (one per line)."); return; }
      patch.options = parsed.options; patch.negative_values = parsed.negative_values;
    }
    if (isScale) patch.comment_threshold = threshold.trim() ? parseInt(threshold, 10) : null;
    setSaving(true);
    const res = await apiFetch(`/api/admin/surveys/forms/${formId}/questions/${fq.id}`, { method: "PATCH", body: JSON.stringify(patch) });
    setSaving(false);
    if (res.ok) { setEditing(false); onChanged(); }
    else setErr((await res.json().catch(() => ({}))).error ?? "Failed to save");
  }
  async function remove() {
    if (!confirm("Remove this question from this form?")) return;
    const res = await apiFetch(`/api/admin/surveys/forms/${formId}/questions/${fq.id}`, { method: "DELETE" });
    if (res.ok) onChanged();
  }

  if (editing) {
    const small = "rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100";
    return (
      <li className="space-y-2 rounded-md border border-blue-200 p-2 dark:border-blue-900">
        <input value={text} onChange={(e) => setText(e.target.value)} className={`w-full ${small}`} />
        {s.type === "choice" && (
          <div className="grid gap-2 sm:grid-cols-2">
            <textarea value={optionsText} onChange={(e) => setOptionsText(e.target.value)} rows={3} placeholder={"Excellent\nGood\nFair\nPoor"} className={`w-full ${small}`} />
            <input value={negText} onChange={(e) => setNegText(e.target.value)} placeholder="Problem options: Fair, Poor" className={`w-full ${small}`} />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300"><input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} className="accent-blue-600" /> required</label>
          <label className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300"><input type="checkbox" checked={collectComment} onChange={(e) => setCollectComment(e.target.checked)} className="accent-blue-600" /> comment on negative</label>
          {isScale && collectComment && (
            <label className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300">comment ≤ <input type="number" min={1} max={s.type === "scale10" ? 10 : 5} value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder={s.type === "scale10" ? "6" : "3"} className={`w-14 ${small}`} /></label>
          )}
        </div>
        {err && <p className="text-xs text-red-500 dark:text-red-400">{err}</p>}
        <div className="flex items-center gap-2">
          <button onClick={save} disabled={saving || text.trim().length < 3} className="rounded bg-blue-600 px-2 py-1 text-xs text-white disabled:opacity-50">Save</button>
          <button onClick={() => { setEditing(false); setErr(null); }} className="text-xs text-gray-500 hover:underline dark:text-gray-400">Cancel</button>
        </div>
      </li>
    );
  }

  return (
    <li className="group flex items-start justify-between gap-3">
      <span className="leading-snug"><span className="text-gray-400">•</span> {s.text}{s.required ? <span className="text-red-500" title="Required">*</span> : null} <span className="text-[10px] uppercase text-gray-400">({s.type})</span>{s.collect_comment === false ? <span className="text-[10px] text-gray-400"> · no comment</span> : (s.comment_threshold != null ? <span className="text-[10px] text-gray-400"> · comment ≤ {s.comment_threshold}</span> : null)}</span>
      {editable && (
        <span className="flex flex-shrink-0 items-center gap-2 opacity-0 focus-within:opacity-100 group-hover:opacity-100">
          <button onClick={() => setEditing(true)} className="text-xs text-blue-500 hover:underline dark:text-blue-400">Edit</button>
          <button onClick={remove} className="text-xs text-red-500 hover:underline dark:text-red-400">Remove</button>
        </span>
      )}
    </li>
  );
}

function ManualTestPanel({ formId, templateCode }: { formId: string; templateCode: string }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ its: string; name: string | null }[] | null>(null);
  const [selected, setSelected] = useState<Record<string, string>>({}); // its -> name
  const [deliver, setDeliver] = useState(false);
  const [out, setOut] = useState<{ its: string; name: string | null; phone: string | null; link?: string; delivered?: boolean; error?: string }[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function search() {
    if (!q.trim()) return;
    const res = await apiFetch(`/api/admin/surveys/responses?q=${encodeURIComponent(q.trim())}`);
    const j = await res.json().catch(() => ({}));
    setResults(j.matches ?? []);
  }
  function toggle(its: string, name: string | null) {
    setSelected((s) => { const n = { ...s }; if (n[its]) delete n[its]; else n[its] = name ?? its; return n; });
  }
  async function generate() {
    const its = Object.keys(selected);
    if (its.length === 0) return;
    setBusy(true);
    const res = await apiFetch(`/api/admin/surveys/forms/${formId}/test-batch`, { method: "POST", body: JSON.stringify({ its, deliver, template: templateCode || undefined }) });
    const j = await res.json().catch(() => ({}));
    setOut(j.recipients ?? []);
    setBusy(false);
  }

  const small = "rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:placeholder-gray-500";
  const chosen = Object.entries(selected);

  return (
    <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/40">
      <p className="mb-2 text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Send test to selected people (in-team testing — no exposures, excluded from results)</p>
      <div className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") search(); }} placeholder="Search by name or ITS…" className={`flex-1 ${small}`} />
        <button onClick={search} className="rounded bg-blue-600 px-3 py-1 text-xs text-white">Search</button>
      </div>

      {results && (
        <div className="mt-2 max-h-44 divide-y divide-gray-100 overflow-auto rounded border border-gray-200 dark:divide-gray-800 dark:border-gray-700">
          {results.length === 0 && <p className="px-2 py-1 text-xs text-gray-400">No matches.</p>}
          {results.map((r) => (
            <label key={r.its} className="flex cursor-pointer items-center justify-between gap-3 px-2 py-1 text-xs hover:bg-blue-50/50 dark:hover:bg-gray-800/50">
              <span className="flex items-center gap-2"><input type="checkbox" checked={Boolean(selected[r.its])} onChange={() => toggle(r.its, r.name)} className="accent-blue-600" /> <span className="text-gray-700 dark:text-gray-300">{r.name ?? "—"}</span></span>
              <span className="font-mono text-gray-400">{r.its}</span>
            </label>
          ))}
        </div>
      )}

      {chosen.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {chosen.map(([its, name]) => (
            <button key={its} onClick={() => toggle(its, name)} className="rounded-full bg-blue-600/15 px-2 py-0.5 text-[11px] text-blue-700 dark:text-blue-300" title="Remove">{name} ✕</button>
          ))}
        </div>
      )}

      <div className="mt-2 flex items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300"><input type="checkbox" checked={deliver} onChange={(e) => setDeliver(e.target.checked)} className="accent-blue-600" /> also send to their WhatsApp</label>
        <button onClick={generate} disabled={busy || chosen.length === 0} className="rounded bg-emerald-600 px-3 py-1 text-xs text-white disabled:opacity-50">
          {busy ? "Working…" : `Generate ${chosen.length || ""} test link${chosen.length === 1 ? "" : "s"}`}
        </button>
      </div>

      {out && (
        <div className="mt-3 max-h-72 space-y-1 overflow-auto">
          {out.map((r, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="w-28 truncate text-gray-600 dark:text-gray-300">{r.name ?? r.its}</span>
              {r.error
                ? <span className="text-amber-600 dark:text-amber-400">{r.error}</span>
                : <>
                    <input readOnly value={r.link ?? ""} className="flex-1 rounded border border-gray-300 bg-white px-2 py-0.5 text-gray-700 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300" />
                    <button onClick={() => copy(r.link ?? "")} className="rounded bg-blue-600 px-2 py-0.5 text-white">Copy</button>
                    {r.delivered && <span className="text-emerald-600 dark:text-emerald-400">sent</span>}
                  </>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type Lookup = {
  mumin: { its: string; name: string | null };
  overall_sentiment: number | null;
  answered: number;
  forms_received: { title: string; status: string; completed_at: string | null; event_date: string | null; is_test: boolean }[];
  sections: { title: string; sentiment: number | null; responses: number }[];
  answers: { form_title: string; section_title: string; question: string; answer: string | null; sentiment: number | null; reason: string | null; date: string | null }[];
};

function LookupTab({ initialIts }: { initialIts?: string | null }) {
  const [q, setQ] = useState("");
  const [matches, setMatches] = useState<{ its: string; name: string | null }[] | null>(null);
  const [data, setData] = useState<Lookup | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Auto-load when arrived here via a clicked sample/lookup record.
  useEffect(() => {
    if (initialIts) void load(initialIts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialIts]);

  async function search() {
    if (!q.trim()) return;
    setBusy(true); setErr(null); setData(null); setMatches(null);
    const res = await apiFetch(`/api/admin/surveys/responses?q=${encodeURIComponent(q.trim())}`);
    const json = await res.json().catch(() => ({}));
    setMatches(json.matches ?? []);
    setBusy(false);
  }
  async function load(its: string) {
    setBusy(true); setErr(null); setMatches(null);
    const res = await apiFetch(`/api/admin/surveys/responses?its=${encodeURIComponent(its)}`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(json.error ?? "Lookup failed"); setBusy(false); return; }
    setData(json as Lookup);
    setBusy(false);
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") search(); }}
          placeholder="Look up a mumin by name or ITS…"
          className={`flex-1 ${inputCls}`}
        />
        <button onClick={search} disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">Search</button>
      </div>
      {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{err}</p>}

      {matches && (
        matches.length === 0
          ? <p className="text-sm text-gray-500 dark:text-gray-400">No matching mumineen.</p>
          : <div className="divide-y divide-gray-100 rounded-lg border border-gray-200 dark:divide-gray-800 dark:border-gray-700">
              {matches.map((m) => (
                <button key={m.its} onClick={() => load(m.its)} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-blue-50/50 dark:hover:bg-gray-800/50">
                  <span className="text-gray-800 dark:text-gray-200">{m.name ?? "—"}</span>
                  <span className="font-mono text-xs text-gray-400">{m.its}</span>
                </button>
              ))}
            </div>
      )}

      {data && (
        <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{data.mumin.name ?? "—"} <span className="font-mono text-xs text-gray-400">{data.mumin.its}</span></p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{data.answered} answers · {data.forms_received.length} forms sent</p>
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">overall <SentimentBadge value={data.overall_sentiment} /></div>
          </div>

          {data.forms_received.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {data.forms_received.map((f, i) => (
                <span key={i} className="rounded border border-gray-200 px-2 py-0.5 text-[11px] text-gray-600 dark:border-gray-700 dark:text-gray-300">
                  {f.title} · {f.completed_at ? "responded" : f.status}{f.is_test ? " · test" : ""}
                </span>
              ))}
            </div>
          )}

          {data.sections.length > 0 && (
            <div className="mb-3">
              <p className="mb-1 text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Their sentiment by section</p>
              {data.sections.map((s, i) => (
                <div key={i} className="flex items-center justify-between py-0.5">
                  <span className="text-xs text-gray-700 dark:text-gray-300">{s.title} <span className="text-gray-400">({s.responses})</span></span>
                  <SentimentBadge value={s.sentiment} />
                </div>
              ))}
            </div>
          )}

          {data.answers.length === 0
            ? <p className="text-xs text-gray-500 dark:text-gray-400">No submitted answers yet.</p>
            : <div className="space-y-2">
                <p className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Answers</p>
                {data.answers.map((a, i) => (
                  <div key={i} className="border-t border-gray-200 pt-2 dark:border-gray-700">
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-xs text-gray-700 dark:text-gray-300">{a.question}</span>
                      <SentimentBadge value={a.sentiment} />
                    </div>
                    <p className="mt-0.5 text-xs font-medium text-gray-900 dark:text-gray-100">{a.answer ?? "—"}</p>
                    {a.reason && <p className="mt-0.5 text-[11px] italic text-gray-500 dark:text-gray-400">“{a.reason}”</p>}
                    <p className="mt-0.5 text-[10px] uppercase text-gray-400">{a.form_title} · {a.section_title}{a.date ? ` · ${a.date}` : ""}</p>
                  </div>
                ))}
              </div>}
        </div>
      )}
    </div>
  );
}

// "Sends" tab — the free messaging window (who we can template-message for free right now) + the
// survey broadcast history & delivery results (reuses the niyaz BroadcastHistory, scoped to
// feedback_survey sends).
function SendsTab() {
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <div className="space-y-5">
      <FreeWindowPanel />
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Survey sends — delivery results</p>
          <button onClick={() => setRefreshKey((k) => k + 1)} className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400">Refresh</button>
        </div>
        <BroadcastHistory refreshKey={refreshKey} audienceKey="feedback_survey" emptyLabel="No survey broadcasts yet. (Sends only appear here when you Commit & send with a WhatsApp template selected — not 'Manual links only'.)" />
      </div>
    </div>
  );
}

// Static custom-filter view: mumineen who messaged us in the last 24h = reachable for FREE
// (inside WhatsApp's customer-care window). Reuses the broadcast console's preview/export endpoints.
const FREE_WINDOW_RULES = { combinator: "and", rules: [{ field: "hours_since_last_inbound", operator: "<=", value: 24 }] };

function FreeWindowPanel() {
  const [data, setData] = useState<{ total?: number; in_window?: number; out_window?: number; funnel?: { matched: number; with_whatsapp: number; unique: number } } | null>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);

  const preview = useCallback(async () => {
    setBusy(true);
    const res = await apiFetch("/api/admin/templates/preview", { method: "POST", body: JSON.stringify({ audience_key: "custom", rules: FREE_WINDOW_RULES }) });
    setData(await res.json().catch(() => ({})));
    setBusy(false);
  }, []);
  useEffect(() => { void preview(); }, [preview]);

  async function exportCsv() {
    setExporting(true);
    const res = await apiFetch("/api/admin/templates/audience-export", { method: "POST", body: JSON.stringify({ audience_key: "custom", rules: FREE_WINDOW_RULES }) });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `free-window-${Date.now()}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    setExporting(false);
  }

  return (
    <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Free messaging window</p>
      <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
        Mumineen who messaged us in the last 24 hours — reachable now at no template cost (deduped by WhatsApp number).
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
        <div><span className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{busy ? "…" : data?.in_window ?? 0}</span> <span className="text-xs text-gray-500 dark:text-gray-400">free now</span></div>
        <div><span className="text-lg font-semibold text-gray-700 dark:text-gray-200">{data?.total ?? 0}</span> <span className="text-xs text-gray-500 dark:text-gray-400">match the filter</span></div>
        {data?.funnel && <span className="text-xs text-gray-400">{data.funnel.matched} matched · {data.funnel.with_whatsapp} with WhatsApp · {data.funnel.unique} unique numbers</span>}
        <div className="ml-auto flex gap-2">
          <button onClick={preview} disabled={busy} className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800">Refresh</button>
          <button onClick={exportCsv} disabled={exporting} className="rounded bg-blue-600 px-3 py-1 text-xs text-white disabled:opacity-50">{exporting ? "Exporting…" : "Export CSV"}</button>
        </div>
      </div>
    </div>
  );
}

function copy(text: string) { void navigator.clipboard?.writeText(text); }

function PreviewSample({ detail, onPickMumin }: { detail: Detail; onPickMumin?: (its: string) => void }) {
  const [q, setQ] = useState("");
  const f = (detail.funnel ?? {}) as Record<string, number>;
  const sample = (detail.sample ?? []) as { name: string; its: string; fresh: boolean }[];
  const ql = q.trim().toLowerCase();
  const filtered = ql ? sample.filter((s) => s.name.toLowerCase().includes(ql) || s.its.includes(ql)) : sample;
  return (
    <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/40">
      {detail.freeWindow ? <p className="mb-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">Free-window only — sampled from people reachable now at no quota cost.</p> : null}
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-700 dark:text-gray-300">
        <span><b>{f.candidates ?? 0}</b> {detail.freeWindow ? "in window" : "qualify"}</span>
        <span><b>{f.chosen ?? 0}</b> chosen</span>
        <span className="text-emerald-600 dark:text-emerald-400">{f.fresh ?? 0} fresh</span>
        <span className="text-amber-600 dark:text-amber-400">{f.reused ?? 0} reused</span>
        <span className="text-gray-400">{(f.excludedNotAttending ?? 0) > 0 ? `${f.excludedNotAttending} not attending · ` : ""}{(f.excludedUnregistered ?? 0) > 0 ? `${f.excludedUnregistered} unregistered · ` : ""}{f.excludedToday ?? 0} already today · {f.excludedExhausted ?? 0} exhausted · {f.excludedNonResponder ?? 0} non-responders{(f.excludedAlreadySent ?? 0) > 0 ? ` · ${f.excludedAlreadySent} already surveyed` : ""}</span>
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
              <button
                key={i}
                type="button"
                onClick={() => onPickMumin?.(s.its)}
                disabled={!onPickMumin}
                title={onPickMumin ? "View this mumin's feedback details" : undefined}
                className="flex w-full items-center justify-between gap-3 py-1 text-left text-xs enabled:hover:bg-blue-50/50 dark:enabled:hover:bg-gray-800/60"
              >
                <span className="truncate text-gray-700 dark:text-gray-300">{s.name}</span>
                <span className="flex flex-shrink-0 items-center gap-2">
                  <span className="font-mono text-gray-400">{s.its}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] ${s.fresh ? "bg-emerald-600/20 text-emerald-700 dark:text-emerald-400" : "bg-amber-500/20 text-amber-700 dark:text-amber-400"}`}>{s.fresh ? "fresh" : "reused"}</span>
                </span>
              </button>
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

function DetailView({ detail, onPickMumin, onResultsToggleTest, onClose }: { detail: Detail; onPickMumin?: (its: string) => void; onResultsToggleTest?: (include: boolean) => void; onClose?: () => void }) {
  const box = "mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm dark:border-gray-700 dark:bg-gray-800/40";
  if (detail.error) return <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{String(detail.error)}</p>;

  if (detail.kind === "test") {
    const link = String(detail.link ?? "");
    const name = detail.name ? String(detail.name) : null;
    const phone = detail.phone ? String(detail.phone) : null;
    const delivery = detail.delivery as { delivered: boolean; error?: string } | null;
    return (
      <div className={box}>
        <p className="mb-1 text-xs text-gray-500 dark:text-gray-400">
          {name ? `Test for ${name}${phone ? ` (${phone})` : ""}. ` : "Anonymous preview (the form greets a generic “you” — real recipients see their first name). "}
          It&apos;s a test recipient — no exposures written, excluded from results.
        </p>
        {delivery && (
          <p className={`mb-2 text-xs font-medium ${delivery.delivered ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
            {delivery.delivered ? `✓ Queued to ${phone} via WhatsApp.` : `Not delivered: ${delivery.error ?? "unknown error"}`}
          </p>
        )}
        <div className="flex items-center gap-2">
          <input readOnly value={link} className="flex-1 rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-800 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200" />
          <button onClick={() => copy(link)} className="rounded bg-blue-600 px-2 py-1 text-xs text-white">Copy</button>
          <a href={link} target="_blank" rel="noreferrer" className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 dark:border-gray-600 dark:text-gray-200">Open</a>
        </div>
      </div>
    );
  }

  if (detail.kind === "preview") return <PreviewSample detail={detail} onPickMumin={onPickMumin} />;

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
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-gray-800 dark:text-gray-100">
            Response rate: {resp.completed}/{resp.sent} ({Math.round((resp.rate ?? 0) * 100)}%)
            {detail.include_test ? <span className="ml-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] uppercase text-amber-700 dark:text-amber-400">test data</span> : null}
          </p>
          <div className="flex items-center gap-3">
            {(Boolean(detail.test_available) || Boolean(detail.include_test)) && (
              <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
                <input type="checkbox" checked={Boolean(detail.include_test)} onChange={(e) => onResultsToggleTest?.(e.target.checked)} className="accent-blue-600" /> Include test submissions
              </label>
            )}
            {onClose && <button onClick={onClose} className="text-xs text-gray-500 hover:underline dark:text-gray-400">Hide ▲</button>}
          </div>
        </div>
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
