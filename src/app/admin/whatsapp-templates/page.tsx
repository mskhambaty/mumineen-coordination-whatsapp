"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

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
  const adminKey = process.env.NEXT_PUBLIC_ADMIN_KEY ?? "";
  const [userId, setUserId] = useState<string>("");
  const [templates, setTemplates] = useState<TemplateDescriptor[]>([]);
  const [users, setUsers] = useState<SelectableUser[]>([]);
  const [tpl, setTpl] = useState<string>("");
  const [audience, setAudience] = useState<string>("selected_users");
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const headers = useMemo(
    () => ({ "content-type": "application/json", "x-admin-key": adminKey, "x-portal-user-id": userId }),
    [adminKey, userId],
  );

  useEffect(() => {
    try {
      const u = JSON.parse(localStorage.getItem("admin_user") ?? "null") as { id?: string } | null;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (u?.id) setUserId(u.id);
    } catch {
      /* ignore */
    }
  }, []);

  const loadBroadcasts = useCallback(async () => {
    const res = await fetch("/api/admin/templates/broadcasts", { headers });
    if (res.ok) setBroadcasts(((await res.json()).broadcasts as Broadcast[]) ?? []);
  }, [headers]);

  useEffect(() => {
    if (!userId) return;
    void (async () => {
      const res = await fetch("/api/admin/templates", { headers });
      if (res.ok) {
        const data = await res.json();
        setTemplates((data.templates as TemplateDescriptor[]) ?? []);
        setUsers((data.selectable_users as SelectableUser[]) ?? []);
      } else {
        setError("You don't have access to this page, or templates failed to load.");
      }
      await loadBroadcasts();
    })();
  }, [userId, headers, loadBroadcasts]);

  const selectedTpl = templates.find((t) => t.name === tpl) ?? null;

  async function runPreview() {
    setError(null);
    setPreview(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/templates/preview", {
        method: "POST",
        headers,
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
    if (selectedTpl.bodyVarCount > 0) return setError("This console supports no-variable templates only.");
    const ok = window.confirm(
      `Send "${selectedTpl.name}" to ${preview.total} recipients ` +
        `(${preview.in_window} free, ${preview.out_window} paid ≈ $${preview.est_cost_usd})?`,
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/templates/send", {
        method: "POST",
        headers,
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

  return (
    <div className="mx-auto max-w-4xl p-4">
      <h1 className="text-xl font-bold">Send WhatsApp Templates</h1>
      <p className="mt-1 text-sm text-gray-500">
        Manually send an approved template to an audience. Admin / leadership only. Sends are throttled and logged.
      </p>

      {error && <div className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950">{error}</div>}
      {notice && <div className="mt-3 rounded-md bg-green-50 p-3 text-sm text-green-700 dark:bg-green-950">{notice}</div>}

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

        {selectedTpl && (
          <div className="rounded-md bg-gray-50 p-3 text-sm whitespace-pre-wrap dark:bg-gray-900">{selectedTpl.bodyText ?? "(no body preview)"}</div>
        )}

        <label className="block text-xs uppercase tracking-wide text-gray-400">
          Audience
          <select
            value={audience}
            onChange={(e) => {
              setAudience(e.target.value);
              setPreview(null);
            }}
            className={`${input} mt-1 block w-full`}
          >
            {AUDIENCES.map((a) => (
              <option key={a.key} value={a.key}>
                {a.label}
              </option>
            ))}
          </select>
        </label>

        {audience === "selected_users" && (
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-400">Pick users</div>
            <div className="mt-1 max-h-40 overflow-auto rounded-md border border-gray-200 p-2 text-sm dark:border-gray-800">
              {users.map((u) => (
                <label key={u.id} className="flex items-center gap-2 py-0.5">
                  <input
                    type="checkbox"
                    checked={selectedUsers.includes(u.id)}
                    onChange={(e) =>
                      setSelectedUsers((prev) => (e.target.checked ? [...prev, u.id] : prev.filter((x) => x !== u.id)))
                    }
                  />
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
              <b>{preview.total}</b> recipients · <span className="text-green-600">{preview.in_window} free</span> ·{" "}
              <span className="text-amber-600">{preview.out_window} paid</span> ≈ <b>${preview.est_cost_usd}</b>
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={send}
          disabled={busy || !preview || !selectedTpl}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          Send
        </button>
      </section>

      <section className="mt-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Send log</h2>
          <button type="button" onClick={loadBroadcasts} className="text-sm text-blue-600">
            Refresh
          </button>
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
                  <td className="px-2 py-1.5">
                    {b.count_sent}/{b.total_recipients}
                    {b.count_failed > 0 ? ` (${b.count_failed} failed)` : ""}
                  </td>
                  <td className="px-2 py-1.5">
                    {b.count_free}/{b.count_paid}
                  </td>
                  <td className="px-2 py-1.5">${b.est_cost_usd}</td>
                  <td className="px-2 py-1.5 text-xs text-gray-500">{new Date(b.started_at).toLocaleString()}</td>
                </tr>
              ))}
              {broadcasts.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-2 py-3 text-center text-gray-400">
                    No broadcasts yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
