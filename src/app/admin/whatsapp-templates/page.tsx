"use client";

import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "@/lib/admin/client";

type TemplateDescriptor = { name: string; language: string; bodyText: string | null; bodyVarCount: number; category?: string };
type SelectableUser = { id: string; name: string; role: string };
type Preview = { total: number; in_window: number; out_window: number; est_cost_usd: number };
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
];

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
      await loadBroadcasts();
    })();
  }, [loadBroadcasts]);

  const selectedTpl = templates.find((t) => t.name === tpl) ?? null;
  const selectedSingleTpl = templates.find((t) => t.name === singleTpl) ?? null;

  async function runPreview() {
    setError(null);
    setPreview(null);
    setBusy(true);
    try {
      const res = await apiFetch("/api/admin/templates/preview", {
        method: "POST",
        body: JSON.stringify({ audience_key: audience, selected_user_ids: selectedUsers }),
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
    if (selectedTpl.bodyVarCount > 0) return setError("Broadcasts support no-variable templates only. Use single-recipient for templates with variables.");
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
        body: JSON.stringify({ template_code: selectedTpl.name, audience_key: audience, selected_user_ids: selectedUsers }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Send failed");
      setNotice(`Started: ${data.total} queued (${data.free} free / ${data.paid} paid). Draining in batches…`);
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

  return (
    <div className="mx-auto max-w-4xl p-4">
      <h1 className="text-xl font-bold">Send WhatsApp Templates</h1>
      <p className="mt-1 text-sm text-gray-500">
        Broadcast an approved template to an audience, or send a template / free-text to one recipient. Admin / leadership only.
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
            <select value={tpl} onChange={(e) => setTpl(e.target.value)} className={`${input} mt-1 block w-full`}>
              <option value="">Select a template…</option>
              {templates.map((t) => (
                <option key={`${t.name}/${t.language}`} value={t.name}>
                  {t.name} ({t.language}){t.bodyVarCount > 0 ? " — has variables" : ""}
                </option>
              ))}
            </select>
          </label>

          {selectedTpl && <div className="rounded-md bg-gray-50 p-3 text-sm whitespace-pre-wrap dark:bg-gray-900">{selectedTpl.bodyText ?? "(no body preview)"}</div>}

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
              {bodyParams.map((v, i) => (
                <input
                  key={i}
                  value={v}
                  onChange={(e) => setBodyParams((prev) => prev.map((p, j) => (j === i ? e.target.value : p)))}
                  placeholder={`Variable {{${i + 1}}}`}
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
                  <td className="px-2 py-1.5">${b.est_cost_usd}</td>
                  <td className="px-2 py-1.5 text-xs text-gray-500">{new Date(b.started_at).toLocaleString()}</td>
                </tr>
              ))}
              {broadcasts.length === 0 && (
                <tr><td colSpan={7} className="px-2 py-3 text-center text-gray-400">No broadcasts yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
