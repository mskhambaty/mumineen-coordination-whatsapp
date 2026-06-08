"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { QueryBuilder, type Field, type RuleGroupType } from "react-querybuilder";
import "react-querybuilder/dist/query-builder.css";

import { apiFetch } from "@/lib/admin/client";

type TemplateDescriptor = {
  name: string;
  language: string;
  bodyText: string | null;
  bodyVars: string[];
  bodyVarCount: number;
  named: boolean;
  header: { format: string; hasVar: boolean } | null;
  headerVar: string | null;
  urlButtons: { index: number; text: string | null; hasVar: boolean }[];
  category?: string;
};
type SelectableUser = { id: string; name: string; role: string };
type Preview = { total: number; in_window: number; out_window: number; est_cost_usd: number; recipients?: { phone: string; full_name: string | null; its: string | null; inWindow: boolean }[] };
type CatalogField = { key: string; label: string; group: string; type: string; operators: string[]; values: string[] };
type MappableField = { key: string; label: string };
type Binding = { kind: "static"; value: string } | { kind: "field"; field: string };
type Broadcast = {
  id: string;
  template_code: string;
  audience_key: string;
  status: string;
  total_recipients: number;
  count_free: number;
  count_paid: number;
  count_sent: number;
  count_failed: number;
  count_skipped?: number;
  est_cost_usd: number;
  started_at: string;
  finished_at: string | null;
};

const AUDIENCES: { key: string; label: string }[] = [
  { key: "selected_users", label: "Selected users (test)" },
  { key: "chicago_committee", label: "Chicago committee members" },
  { key: "arrived_hof", label: "Arrived families (one per family)" },
  { key: "registered_hof", label: "All registered families (one per family)" },
  { key: "all_members", label: "All family members (deduped by number)" },
  { key: "custom", label: "Custom filter…" },
];

const OP_LABELS: Record<string, string> = {
  "=": "is", "!=": "is not", in: "is any of", notIn: "is none of", contains: "contains",
  null: "is empty", notNull: "is not empty", "<": "before / <", "<=": "≤", ">": "after / >", ">=": "≥", between: "between",
};

const input = "rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900";

export default function SendTemplatesPage() {
  const [mode, setMode] = useState<"broadcast" | "single">("broadcast");
  const [templates, setTemplates] = useState<TemplateDescriptor[]>([]);
  const [users, setUsers] = useState<SelectableUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Broadcast state
  const [tpl, setTpl] = useState<string>("");
  const [audience, setAudience] = useState<string>("selected_users");
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [busy, setBusy] = useState(false);

  // Custom audience + variable bindings
  const [query, setQuery] = useState<RuleGroupType>({ combinator: "and", rules: [] });
  const [catalog, setCatalog] = useState<CatalogField[]>([]);
  const [mappable, setMappable] = useState<MappableField[]>([]);
  const [bindings, setBindings] = useState<Record<string, Binding>>({}); // token | "__header" | "__urlButton"
  const [headerMediaUrl, setHeaderMediaUrl] = useState("");

  // Single-recipient composer state
  const [recipient, setRecipient] = useState("");
  const [singleKind, setSingleKind] = useState<"template" | "text">("text");
  const [singleTpl, setSingleTpl] = useState<string>("");
  const [singleText, setSingleText] = useState("");
  const [bodyParams, setBodyParams] = useState<string[]>([]);
  const [sendingSingle, setSendingSingle] = useState(false);

  const loadBroadcasts = useCallback(async () => {
    const res = await apiFetch("/api/admin/templates/broadcasts");
    if (res.ok) setBroadcasts(((await res.json()).broadcasts as Broadcast[]) ?? []);
  }, []);

  useEffect(() => {
    void (async () => {
      const res = await apiFetch("/api/admin/templates");
      if (res.ok) {
        const data = await res.json();
        setTemplates((data.templates as TemplateDescriptor[]) ?? []);
        setUsers((data.selectable_users as SelectableUser[]) ?? []);
      } else {
        setError("You don't have access to this page, or templates failed to load.");
      }
      const f = await apiFetch("/api/admin/templates/audience-fields");
      if (f.ok) {
        const fd = await f.json();
        setCatalog((fd.fields as CatalogField[]) ?? []);
        setMappable((fd.mappableFields as MappableField[]) ?? []);
      }
      await loadBroadcasts();
    })();
  }, [loadBroadcasts]);

  const selectedTpl = templates.find((t) => t.name === tpl) ?? null;
  const selectedSingleTpl = templates.find((t) => t.name === singleTpl) ?? null;
  const dynamicUrlBtn = selectedTpl?.urlButtons.find((b) => b.hasVar) ?? null;

  const rqbFields: Field[] = useMemo(
    () =>
      catalog.map((f) => {
        const base = { name: f.key, label: `${f.group}: ${f.label}`, operators: f.operators.map((o) => ({ name: o, label: OP_LABELS[o] ?? o })) };
        if (f.type === "bool") return { ...base, valueEditorType: "select" as const, values: [{ name: "true", label: "Yes" }, { name: "false", label: "No" }], defaultValue: "true" };
        if (f.type === "enum") return { ...base, valueEditorType: "multiselect" as const, values: f.values.map((v) => ({ name: v, label: v })) };
        if (f.type === "number") return { ...base, inputType: "number" };
        if (f.type === "date") return { ...base, inputType: "date" };
        return base;
      }),
    [catalog],
  );

  function selectBroadcastTemplate(name: string) {
    setTpl(name);
    setPreview(null);
    const t = templates.find((x) => x.name === name) ?? null;
    const next: Record<string, Binding> = {};
    for (const tok of t?.bodyVars ?? []) next[tok] = { kind: "static", value: "" };
    if (t?.header?.format === "TEXT" && t.headerVar) next["__header"] = { kind: "static", value: "" };
    if (t?.urlButtons.some((b) => b.hasVar)) next["__urlButton"] = { kind: "static", value: "" };
    setBindings(next);
    setHeaderMediaUrl("");
  }

  function setBinding(key: string, b: Binding) {
    setBindings((prev) => ({ ...prev, [key]: b }));
  }

  function bindingRow(key: string, label: string) {
    const b = bindings[key] ?? { kind: "static", value: "" };
    return (
      <div key={key} className="flex flex-wrap items-center gap-2">
        <span className="w-36 shrink-0 text-xs uppercase tracking-wide text-gray-400">{label}</span>
        <select value={b.kind} onChange={(e) => setBinding(key, e.target.value === "field" ? { kind: "field", field: mappable[0]?.key ?? "full_name" } : { kind: "static", value: "" })} className={`${input} w-28`}>
          <option value="static">Static</option>
          <option value="field">Field</option>
        </select>
        {b.kind === "static" ? (
          <input value={b.value} onChange={(e) => setBinding(key, { kind: "static", value: e.target.value })} placeholder="value for everyone" className={`${input} flex-1`} />
        ) : (
          <select value={b.field} onChange={(e) => setBinding(key, { kind: "field", field: e.target.value })} className={`${input} flex-1`}>
            {mappable.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
        )}
      </div>
    );
  }

  function buildBindingsPayload() {
    const body: Record<string, Binding> = {};
    for (const tok of selectedTpl?.bodyVars ?? []) body[tok] = bindings[tok] ?? { kind: "static", value: "" };
    return {
      body,
      header: selectedTpl?.headerVar ? bindings["__header"] : undefined,
      headerMediaUrl: selectedTpl?.header && selectedTpl.header.format !== "TEXT" ? headerMediaUrl : undefined,
      urlButton: selectedTpl?.urlButtons.some((b) => b.hasVar) ? bindings["__urlButton"] : undefined,
    };
  }

  function previewText(): string {
    if (!selectedTpl?.bodyText) return "";
    return selectedTpl.bodyText.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, tok) => {
      const b = bindings[tok];
      if (!b) return `{{${tok}}}`;
      return b.kind === "static" ? (b.value || `{{${tok}}}`) : `[${mappable.find((m) => m.key === b.field)?.label ?? b.field}]`;
    });
  }

  async function runPreview() {
    setError(null);
    setPreview(null);
    setBusy(true);
    try {
      const res = await apiFetch("/api/admin/templates/preview", {
        method: "POST",
        body: JSON.stringify({ audience_key: audience, selected_user_ids: selectedUsers, rules: audience === "custom" ? query : undefined, include_recipients: true, limit: 50 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Preview failed");
      setPreview(data as Preview);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!selectedTpl) return setError("Pick a template.");
    if (!preview) return setError("Run a preview first.");
    const ok = window.confirm(
      `Send "${selectedTpl.name}" to ${preview.total} recipients ` +
        `(${preview.in_window} free, ${preview.out_window} paid ≈ $${preview.est_cost_usd})?`,
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch("/api/admin/templates/send", {
        method: "POST",
        body: JSON.stringify({
          template_code: selectedTpl.name,
          template_language: selectedTpl.language,
          audience_key: audience,
          selected_user_ids: selectedUsers,
          rules: audience === "custom" ? query : undefined,
          variable_bindings: buildBindingsPayload(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Send failed");
      setNotice(`Started: ${data.total} queued (${data.free} free / ${data.paid} paid${data.skipped ? `, ${data.skipped} skipped` : ""}). Draining in batches…`);
      setPreview(null);
      await loadBroadcasts();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed");
    } finally {
      setBusy(false);
    }
  }

  async function sendSingle() {
    setError(null);
    setNotice(null);
    if (!recipient.trim()) return setError("Enter an ITS or phone number.");
    if (singleKind === "text" && !singleText.trim()) return setError("Enter a message.");
    if (singleKind === "template" && !selectedSingleTpl) return setError("Pick a template.");
    setSendingSingle(true);
    try {
      const body =
        singleKind === "text"
          ? { its: recipient.trim(), kind: "text", text: singleText.trim() }
          : {
              its: recipient.trim(),
              kind: "template",
              template: { name: selectedSingleTpl!.name, language: selectedSingleTpl!.language, bodyParams },
            };
      const res = await apiFetch("/api/admin/whatsapp/send", { method: "POST", body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Send failed");
      setNotice(`Sent ${singleKind === "template" ? `template "${data.template}"` : "message"} to ${data.name ?? data.to}.`);
      setSingleText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed");
    } finally {
      setSendingSingle(false);
    }
  }

  const hasVars = (selectedTpl?.bodyVars.length ?? 0) > 0 || Boolean(selectedTpl?.headerVar) || (selectedTpl?.header && selectedTpl.header.format !== "TEXT") || Boolean(dynamicUrlBtn);

  return (
    <div className="mx-auto max-w-4xl p-4">
      <h1 className="text-xl font-bold">Send WhatsApp Templates</h1>
      <p className="mt-1 text-sm text-gray-500">
        Broadcast an approved template to an audience (preset or custom filter), with per-recipient personalization, or send to one recipient. Admin / leadership only.
      </p>

      <div className="mt-3 flex gap-2">
        <button type="button" onClick={() => setMode("broadcast")} className={`rounded-md px-3 py-1.5 text-sm font-medium ${mode === "broadcast" ? "bg-blue-600 text-white" : "border border-gray-300 dark:border-gray-700"}`}>
          Broadcast
        </button>
        <button type="button" onClick={() => setMode("single")} className={`rounded-md px-3 py-1.5 text-sm font-medium ${mode === "single" ? "bg-blue-600 text-white" : "border border-gray-300 dark:border-gray-700"}`}>
          Single recipient
        </button>
      </div>

      {error && <div className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950">{error}</div>}
      {notice && <div className="mt-3 rounded-md bg-green-50 p-3 text-sm text-green-700 dark:bg-green-950">{notice}</div>}

      {mode === "broadcast" ? (
        <section className="mt-5 space-y-4 rounded-lg border border-gray-200 p-4 dark:border-gray-800">
          <label className="block text-xs uppercase tracking-wide text-gray-400">
            Template
            <select value={tpl} onChange={(e) => selectBroadcastTemplate(e.target.value)} className={`${input} mt-1 block w-full`}>
              <option value="">Select a template…</option>
              {templates.map((t) => (
                <option key={`${t.name}/${t.language}`} value={t.name}>
                  {t.name} ({t.language}){t.bodyVarCount > 0 ? " — has variables" : ""}
                </option>
              ))}
            </select>
          </label>

          {selectedTpl && <div className="rounded-md bg-gray-50 p-3 text-sm whitespace-pre-wrap dark:bg-gray-900">{previewText() || selectedTpl.bodyText || "(no body preview)"}</div>}

          {/* Variable bindings */}
          {selectedTpl && hasVars && (
            <div className="space-y-2 rounded-md border border-gray-100 p-3 dark:border-gray-800">
              <div className="text-xs uppercase tracking-wide text-gray-400">Variables</div>
              {selectedTpl.headerVar && bindingRow("__header", `Header: ${selectedTpl.headerVar}`)}
              {selectedTpl.header && selectedTpl.header.format !== "TEXT" && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-36 shrink-0 text-xs uppercase tracking-wide text-gray-400">Header media URL</span>
                  <input value={headerMediaUrl} onChange={(e) => setHeaderMediaUrl(e.target.value)} placeholder="https://…" className={`${input} flex-1`} />
                </div>
              )}
              {selectedTpl.bodyVars.map((tok) => bindingRow(tok, `Body: ${tok}`))}
              {dynamicUrlBtn && bindingRow("__urlButton", "URL button value")}
              <p className="text-xs text-gray-500">Static = same for everyone. Field = each recipient&apos;s value; recipients missing that field are skipped &amp; reported.</p>
            </div>
          )}

          <label className="block text-xs uppercase tracking-wide text-gray-400">
            Audience
            <select value={audience} onChange={(e) => { setAudience(e.target.value); setPreview(null); }} className={`${input} mt-1 block w-full`}>
              {AUDIENCES.map((a) => (
                <option key={a.key} value={a.key}>{a.label}</option>
              ))}
            </select>
          </label>

          {audience === "selected_users" && (
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-400">Pick users</div>
              <div className="mt-1 max-h-40 overflow-auto rounded-md border border-gray-200 p-2 text-sm dark:border-gray-800">
                {users.map((u) => (
                  <label key={u.id} className="flex items-center gap-2 py-0.5">
                    <input type="checkbox" checked={selectedUsers.includes(u.id)} onChange={(e) => setSelectedUsers((prev) => (e.target.checked ? [...prev, u.id] : prev.filter((x) => x !== u.id)))} />
                    {u.name} <span className="text-gray-400">({u.role})</span>
                  </label>
                ))}
                {users.length === 0 && <div className="text-gray-400">No committee/admin users found.</div>}
              </div>
            </div>
          )}

          {audience === "custom" && (
            <div className="rounded-md border border-gray-100 p-3 text-sm dark:border-gray-800">
              <div className="mb-2 text-xs uppercase tracking-wide text-gray-400">Custom filter</div>
              <QueryBuilder fields={rqbFields} query={query} onQueryChange={setQuery} />
            </div>
          )}

          <div className="flex items-center gap-3">
            <button type="button" onClick={runPreview} disabled={busy} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium disabled:opacity-50 dark:border-gray-700">
              Preview audience
            </button>
            {preview && (
              <span className="text-sm">
                <b>{preview.total}</b> recipients · <span className="text-green-600">{preview.in_window} free</span> · <span className="text-amber-600">{preview.out_window} paid</span> ≈ <b>${preview.est_cost_usd}</b>
              </span>
            )}
          </div>

          {preview?.recipients && preview.recipients.length > 0 && (
            <div className="max-h-56 overflow-auto rounded-md border border-gray-100 dark:border-gray-800">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-gray-50 uppercase text-gray-400 dark:bg-gray-900"><tr><th className="px-2 py-1">Name</th><th className="px-2 py-1">ITS</th><th className="px-2 py-1">Phone</th><th className="px-2 py-1">Window</th></tr></thead>
                <tbody>
                  {preview.recipients.map((r) => (
                    <tr key={r.phone} className="border-t border-gray-100 dark:border-gray-800"><td className="px-2 py-1">{r.full_name ?? "—"}</td><td className="px-2 py-1 font-mono">{r.its ?? "—"}</td><td className="px-2 py-1">{r.phone}</td><td className="px-2 py-1">{r.inWindow ? "free" : "paid"}</td></tr>
                  ))}
                </tbody>
              </table>
              <p className="px-2 py-1 text-[11px] text-gray-400">Showing up to 50 of {preview.total}.</p>
            </div>
          )}

          <button type="button" onClick={send} disabled={busy || !preview || !selectedTpl} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            Send broadcast
          </button>
        </section>
      ) : (
        <section className="mt-5 space-y-4 rounded-lg border border-gray-200 p-4 dark:border-gray-800">
          <label className="block text-xs uppercase tracking-wide text-gray-400">
            Recipient (ITS or phone)
            <input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="40495151 or +1…" className={`${input} mt-1 block max-w-xs`} />
          </label>

          <div className="flex gap-2">
            <button type="button" onClick={() => setSingleKind("text")} className={`rounded-md px-3 py-1.5 text-sm font-medium ${singleKind === "text" ? "bg-blue-600 text-white" : "border border-gray-300 dark:border-gray-700"}`}>Free text</button>
            <button type="button" onClick={() => setSingleKind("template")} className={`rounded-md px-3 py-1.5 text-sm font-medium ${singleKind === "template" ? "bg-blue-600 text-white" : "border border-gray-300 dark:border-gray-700"}`}>Template</button>
          </div>

          {singleKind === "text" ? (
            <textarea value={singleText} onChange={(e) => setSingleText(e.target.value)} rows={4} placeholder="Message…" className={`${input} block w-full`} />
          ) : (
            <div className="space-y-3">
              <select
                value={singleTpl}
                onChange={(e) => {
                  setSingleTpl(e.target.value);
                  const t = templates.find((x) => x.name === e.target.value);
                  setBodyParams(t ? Array(t.bodyVarCount).fill("") : []);
                }}
                className={`${input} block w-full`}
              >
                <option value="">Select a template…</option>
                {templates.map((t) => (
                  <option key={`${t.name}/${t.language}`} value={t.name}>{t.name} ({t.language})</option>
                ))}
              </select>
              {selectedSingleTpl && <div className="rounded-md bg-gray-50 p-3 text-sm whitespace-pre-wrap dark:bg-gray-900">{selectedSingleTpl.bodyText ?? "(no body preview)"}</div>}
              {(selectedSingleTpl?.bodyVars ?? bodyParams.map((_, i) => String(i + 1))).map((tok, i) => (
                <input
                  key={i}
                  value={bodyParams[i] ?? ""}
                  onChange={(e) => setBodyParams((prev) => { const n = [...prev]; n[i] = e.target.value; return n; })}
                  placeholder={`Variable {{${tok}}}`}
                  className={`${input} block w-full`}
                />
              ))}
            </div>
          )}

          <button type="button" onClick={sendSingle} disabled={sendingSingle} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            Send to recipient
          </button>
        </section>
      )}

      <section className="mt-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Broadcast log</h2>
          <button type="button" onClick={loadBroadcasts} className="text-sm text-blue-600">Refresh</button>
        </div>
        <div className="mt-2 overflow-auto rounded-lg border border-gray-200 dark:border-gray-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500 dark:bg-gray-900">
              <tr>
                <th className="px-2 py-1.5">Template</th>
                <th className="px-2 py-1.5">Audience</th>
                <th className="px-2 py-1.5">Status</th>
                <th className="px-2 py-1.5">Sent/Total</th>
                <th className="px-2 py-1.5">Free/Paid</th>
                <th className="px-2 py-1.5">Skipped</th>
                <th className="px-2 py-1.5">Cost</th>
                <th className="px-2 py-1.5">Started</th>
              </tr>
            </thead>
            <tbody>
              {broadcasts.map((b) => (
                <tr key={b.id} className="border-t border-gray-100 dark:border-gray-800">
                  <td className="px-2 py-1.5 font-mono text-xs">{b.template_code}</td>
                  <td className="px-2 py-1.5">{b.audience_key}</td>
                  <td className="px-2 py-1.5">{b.status}</td>
                  <td className="px-2 py-1.5">{b.count_sent}/{b.total_recipients}{b.count_failed > 0 ? ` (${b.count_failed} failed)` : ""}</td>
                  <td className="px-2 py-1.5">{b.count_free}/{b.count_paid}</td>
                  <td className="px-2 py-1.5">{b.count_skipped ?? 0}</td>
                  <td className="px-2 py-1.5">${b.est_cost_usd}</td>
                  <td className="px-2 py-1.5 text-xs text-gray-500">{new Date(b.started_at).toLocaleString()}</td>
                </tr>
              ))}
              {broadcasts.length === 0 && (
                <tr><td colSpan={8} className="px-2 py-3 text-center text-gray-400">No broadcasts yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
