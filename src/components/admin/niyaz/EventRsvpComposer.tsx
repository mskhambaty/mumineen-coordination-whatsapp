"use client";

import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "@/lib/admin/client";
import BroadcastHistory from "@/components/admin/niyaz/BroadcastHistory";

// Day-level RSVP config + broadcast composer for one Niyaz day. Config (event title, lunch/dinner
// menus, RSVP cutoff, which meals, which template) is keyed by date (niyaz_event_config); the
// broadcast (audience + preview + per-recipient button payloads + send, incl. a single-ITS test)
// runs against the day's representative registration instance. Buttons default to the
// ashara_relay_double_rsvp Flow + quick-reply structure; {{tokens}} resolve per recipient at send
// time. Send/preview are disabled when the day has no registration instance.

type Config = {
  rsvpEventTitle: string | null;
  lunchMenu: string | null;
  dinnerMenu: string | null;
  rsvpEndTime: string | null;
  hasLunch: boolean;
  hasDinner: boolean;
  templateCode: string | null;
};

type SampleRow = { name: string | null; its: string | null; phone_masked: string };

type TemplatePreview = {
  name: string;
  language: string;
  bodyText: string | null;
  footerText: string | null;
  header: { format: string; text: string | null } | null;
  buttons: { type: string; text: string | null }[];
};

type Binding = { kind: "static"; value: string } | { kind: "field"; field: string };

// Roster fields offered for per-recipient ("Field") variable bindings (mirrors the Send Templates
// console; family_members is the computed family-member-names field).
const MAPPABLE: { key: string; label: string }[] = [
  { key: "full_name", label: "Full name" },
  { key: "family_members", label: "Family members" },
  { key: "its", label: "ITS" },
  { key: "hof_its", label: "HOF ITS" },
  { key: "jamaat", label: "Jamaat" },
  { key: "city", label: "City" },
  { key: "category", label: "Category" },
  { key: "venue", label: "Venue" },
  { key: "gender", label: "Gender" },
  { key: "local_mehman", label: "Local / Mehman" },
];

// Ordered, de-duped {{tokens}} in a template string.
function extractTokens(text: string | null | undefined): string[] {
  if (!text) return [];
  const seen: string[] = [];
  const re = /\{\{\s*([\w.]+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) if (!seen.includes(m[1])) seen.push(m[1]);
  return seen;
}

// Smart default binding for a token (mirrors the server's bindToken): event-config statics, person
// fields for name/family_members, else an empty static.
function defaultBinding(token: string, config: Config): Binding {
  const t = token.toLowerCase();
  if (t === "rsvp_event_title") return { kind: "static", value: config.rsvpEventTitle ?? "" };
  if (t === "lunch_menu" || t === "lunch") return { kind: "static", value: config.lunchMenu ?? "" };
  if (t === "dinner_menu" || t === "dinner") return { kind: "static", value: config.dinnerMenu ?? "" };
  if (t === "rsvp_end_time" || t === "end_time") return { kind: "static", value: config.rsvpEndTime ?? "" };
  if (["name", "person_name", "full_name"].includes(t)) return { kind: "field", field: "full_name" };
  if (t === "family_members") return { kind: "field", field: "family_members" };
  return { kind: "static", value: "" };
}

type AudienceKey = "all_hof" | "all_hof_unresponded" | "specific_its";

const DEFAULT_TEMPLATE = "ashara_relay_double_rsvp";

// Default per-recipient button spec for ashara_relay_double_rsvp: a Flow button ("Attending") that
// opens the RSVP flow, and a quick-reply ("Not attending"). {{Person.Id}}, {{RegistrationInstanceId}}
// and {{EligibleFamilyCount}} are substituted per recipient.
const DEFAULT_BUTTONS = JSON.stringify(
  [
    {
      type: "flow",
      index: 0,
      flow_token: "rsvp:{{Person.Id}}:{{RegistrationInstanceId}}",
      flow_action_data: {
        person_id: "{{Person.Id}}",
        registration_instance_id: "{{RegistrationInstanceId}}",
        attending_count: "{{EligibleFamilyCount}}",
      },
    },
    { type: "quick_reply", index: 1, payload: "not-attending-{{Person.Id}}-{{RegistrationInstanceId}}" },
  ],
  null,
  2,
);

const inputCls =
  "block w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-950";

const labelCls = "text-xs uppercase tracking-wide text-gray-400";

// Map the audience radio to the broadcast API params.
function audienceParams(audience: AudienceKey, testIts: string) {
  if (audience === "specific_its") {
    return { audience: "specific_its", level: "ind", its: testIts.split(/[\s,]+/).filter(Boolean), require_registered: false, only_non_responders: false };
  }
  return {
    audience: "all_hof",
    level: "fam",
    require_registered: false,
    only_non_responders: audience === "all_hof_unresponded",
    its: [] as string[],
  };
}

export default function EventRsvpComposer({
  date,
  instanceId,
  title,
  onSaved,
}: {
  date: string;
  instanceId: string | null;
  title: string;
  onSaved?: () => void;
}) {
  const [config, setConfig] = useState<Config>({ rsvpEventTitle: "", lunchMenu: "", dinnerMenu: "", rsvpEndTime: "", hasLunch: false, hasDinner: false, templateCode: DEFAULT_TEMPLATE });
  const [savingConfig, setSavingConfig] = useState(false);
  const [configSaved, setConfigSaved] = useState(false);
  const [templates, setTemplates] = useState<TemplatePreview[]>([]);
  const [bindings, setBindings] = useState<Record<string, Binding>>({});

  const [audience, setAudience] = useState<AudienceKey>("all_hof");
  const [testIts, setTestIts] = useState("");
  const [buttonsJson, setButtonsJson] = useState(DEFAULT_BUTTONS);

  const [preview, setPreview] = useState<{ count: number; sample: SampleRow[]; unresolved: string[] } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [lastBroadcastId, setLastBroadcastId] = useState<string | null>(null);

  const loadConfig = useCallback(async () => {
    const res = await apiFetch(`/api/admin/niyaz/days/${date}`);
    if (!res.ok) return;
    const data = await res.json().catch(() => ({}));
    const c = data.config as Config | null;
    if (c) {
      setConfig({
        rsvpEventTitle: c.rsvpEventTitle ?? "",
        lunchMenu: c.lunchMenu ?? "",
        dinnerMenu: c.dinnerMenu ?? "",
        rsvpEndTime: c.rsvpEndTime ?? "",
        hasLunch: c.hasLunch,
        hasDinner: c.hasDinner,
        templateCode: c.templateCode ?? DEFAULT_TEMPLATE,
      });
    }
  }, [date]);

  // The parent remounts this component (key={date}) when the selected day changes, so state starts
  // fresh; the effect only needs to load the saved config.
  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  // Template options from the niyaz RSVP number's WABA (630 763 8963 broadcast account).
  useEffect(() => {
    void (async () => {
      const res = await apiFetch("/api/admin/niyaz/templates");
      if (res.ok) setTemplates(((await res.json()).templates as TemplatePreview[]) ?? []);
    })();
  }, []);

  const selectedTemplate = templates.find((t) => t.name === config.templateCode) ?? null;
  const bodyTokens = extractTokens(selectedTemplate?.bodyText);

  // The effective binding for a token: an explicit override, else the smart default (which reads the
  // day's config live, so editing a menu above updates the preview until the binding is overridden).
  const effBinding = (tok: string): Binding => bindings[tok] ?? defaultBinding(tok, config);
  const setBinding = (tok: string, b: Binding) => setBindings((prev) => ({ ...prev, [tok]: b }));

  function previewText(text: string): string {
    return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, tok: string) => {
      const b = effBinding(tok);
      return b.kind === "static" ? b.value || `{{${tok}}}` : `[${MAPPABLE.find((m) => m.key === b.field)?.label ?? b.field}]`;
    });
  }

  async function saveConfig() {
    setSavingConfig(true);
    setConfigSaved(false);
    setError(null);
    try {
      const res = await apiFetch(`/api/admin/niyaz/days/${date}`, {
        method: "PUT",
        body: JSON.stringify({
          rsvp_event_title: config.rsvpEventTitle || null,
          lunch_menu: config.lunchMenu || null,
          dinner_menu: config.dinnerMenu || null,
          rsvp_end_time: config.rsvpEndTime || null,
          has_lunch: config.hasLunch,
          has_dinner: config.hasDinner,
          template_code: config.templateCode || null,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Save failed");
      setConfigSaved(true);
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSavingConfig(false);
    }
  }

  function parseButtons(): unknown[] | null {
    try {
      const parsed = JSON.parse(buttonsJson);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  async function runPreview() {
    if (!instanceId) {
      setError("No registration instance exists for this date yet — create one on the Niyaz events page to send/preview.");
      return;
    }
    setPreviewing(true);
    setError(null);
    setResult(null);
    try {
      const p = audienceParams(audience, testIts);
      const qs = new URLSearchParams({
        audience: p.audience,
        level: p.level,
        require_registered: String(p.require_registered),
        only_non_responders: String(p.only_non_responders),
      });
      if (p.its.length) qs.set("its", p.its.join(","));
      const res = await apiFetch(`/api/admin/niyaz/instances/${instanceId}/broadcast?${qs.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Preview failed");
      setPreview({ count: data.count ?? 0, sample: (data.sample as SampleRow[]) ?? [], unresolved: (data.unresolved_its as string[]) ?? [] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setPreviewing(false);
    }
  }

  async function send() {
    if (!instanceId) {
      setError("No registration instance exists for this date yet — create one on the Niyaz events page to send.");
      return;
    }
    const buttons = parseButtons();
    if (!buttons) {
      setError("Button payloads are not valid JSON.");
      return;
    }
    setSending(true);
    setError(null);
    setResult(null);
    try {
      const p = audienceParams(audience, testIts);
      const res = await apiFetch(`/api/admin/niyaz/instances/${instanceId}/broadcast`, {
        method: "POST",
        body: JSON.stringify({
          audience: p.audience,
          level: p.level,
          require_registered: p.require_registered,
          only_non_responders: p.only_non_responders,
          its: p.its,
          template_code: config.templateCode || DEFAULT_TEMPLATE,
          buttons,
          variable_bindings: { body: Object.fromEntries(bodyTokens.map((t) => [t, effBinding(t)])) },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Send failed");
      setResult(`Started: ${data.total} recipient(s), ${data.skipped} skipped, est $${data.estCostUsd ?? 0}.`);
      if (data.broadcastId) setLastBroadcastId(data.broadcastId as string);
      setHistoryRefresh((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mt-6 rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <h2 className="mb-1 text-lg font-semibold">Send RSVP — {title}</h2>
      <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
        Configure this event, choose an audience, preview it, then send. Sends go out from the niyaz RSVP number
        (determined by the template&apos;s WhatsApp account).
      </p>

      {/* Config */}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="sm:col-span-2">
          <span className={labelCls}>Event title (rsvp_event_title)</span>
          <input value={config.rsvpEventTitle ?? ""} onChange={(e) => setConfig({ ...config, rsvpEventTitle: e.target.value })} className={inputCls} />
        </label>
        <label>
          <span className={labelCls}>Lunch menu</span>
          <textarea value={config.lunchMenu ?? ""} onChange={(e) => setConfig({ ...config, lunchMenu: e.target.value })} rows={2} className={inputCls} />
        </label>
        <label>
          <span className={labelCls}>Dinner menu</span>
          <textarea value={config.dinnerMenu ?? ""} onChange={(e) => setConfig({ ...config, dinnerMenu: e.target.value })} rows={2} className={inputCls} />
        </label>
        <label>
          <span className={labelCls}>RSVP end time (rsvp_end_time)</span>
          <input value={config.rsvpEndTime ?? ""} onChange={(e) => setConfig({ ...config, rsvpEndTime: e.target.value })} className={inputCls} placeholder="e.g. Tonight 10pm" />
        </label>
        <label>
          <span className={labelCls}>Template</span>
          <select value={config.templateCode ?? ""} onChange={(e) => setConfig({ ...config, templateCode: e.target.value })} className={inputCls}>
            <option value="">— select a template —</option>
            {config.templateCode && !templates.some((t) => t.name === config.templateCode) && (
              <option value={config.templateCode}>{config.templateCode} (not in WABA)</option>
            )}
            {templates.map((t) => (
              <option key={t.name} value={t.name}>{t.name}</option>
            ))}
          </select>
        </label>
        <div className="sm:col-span-2 flex gap-6">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={config.hasLunch} onChange={(e) => setConfig({ ...config, hasLunch: e.target.checked })} />
            Lunch
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={config.hasDinner} onChange={(e) => setConfig({ ...config, hasDinner: e.target.checked })} />
            Dinner
          </label>
          <button type="button" onClick={saveConfig} disabled={savingConfig} className="ml-auto rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800">
            {savingConfig ? "Saving…" : configSaved ? "Saved ✓" : "Save config"}
          </button>
        </div>
      </div>

      {/* Template preview */}
      {selectedTemplate && (selectedTemplate.bodyText || selectedTemplate.header?.text) && (
        <div className="mb-5">
          <span className={labelCls}>Template preview</span>
          <div className="mt-1 max-w-md whitespace-pre-wrap rounded-lg border border-green-200 bg-green-50 p-3 text-sm shadow-sm dark:border-green-900 dark:bg-green-950/40">
            {selectedTemplate.header?.text && <p className="mb-1 font-semibold">{previewText(selectedTemplate.header.text)}</p>}
            {selectedTemplate.bodyText && <p>{previewText(selectedTemplate.bodyText)}</p>}
            {selectedTemplate.footerText && (
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{previewText(selectedTemplate.footerText)}</p>
            )}
            {selectedTemplate.buttons.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1 border-t border-green-200 pt-2 dark:border-green-900">
                {selectedTemplate.buttons.map((b, i) => (
                  <span key={i} className="rounded border border-gray-300 bg-white px-2 py-0.5 text-xs text-blue-600 dark:border-gray-700 dark:bg-gray-900 dark:text-blue-400">
                    {b.text || b.type}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Per-variable bindings */}
      {bodyTokens.length > 0 && (
        <div className="mb-5">
          <span className={labelCls}>Variables</span>
          <div className="mt-1 space-y-2">
            {bodyTokens.map((tok) => {
              const b = effBinding(tok);
              return (
                <div key={tok} className="flex items-center gap-2">
                  <span className="w-44 shrink-0 truncate font-mono text-xs text-gray-600 dark:text-gray-300" title={tok}>{tok}</span>
                  <select
                    value={b.kind}
                    onChange={(e) => setBinding(tok, e.target.value === "field" ? { kind: "field", field: b.kind === "field" ? b.field : MAPPABLE[0].key } : { kind: "static", value: b.kind === "static" ? b.value : "" })}
                    className={`${inputCls} w-28`}
                  >
                    <option value="static">Static</option>
                    <option value="field">Field</option>
                  </select>
                  {b.kind === "static" ? (
                    <input value={b.value} onChange={(e) => setBinding(tok, { kind: "static", value: e.target.value })} placeholder="value for everyone" className={`${inputCls} flex-1`} />
                  ) : (
                    <select value={b.field} onChange={(e) => setBinding(tok, { kind: "field", field: e.target.value })} className={`${inputCls} flex-1`}>
                      {MAPPABLE.map((m) => (
                        <option key={m.key} value={m.key}>{m.label}</option>
                      ))}
                    </select>
                  )}
                </div>
              );
            })}
          </div>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Static = same for everyone. Field = each recipient&apos;s value; recipients missing that field are skipped &amp; reported.</p>
        </div>
      )}

      {/* Audience */}
      <div className="mb-4">
        <span className={labelCls}>Audience</span>
        <div className="mt-1 space-y-1 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="audience" checked={audience === "all_hof"} onChange={() => setAudience("all_hof")} />
            All HOF (roster-active, not marked not-attending)
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="audience" checked={audience === "all_hof_unresponded"} onChange={() => setAudience("all_hof_unresponded")} />
            All HOF — not yet responded to this event
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="audience" checked={audience === "specific_its"} onChange={() => setAudience("specific_its")} />
            Test: specific ITS
          </label>
          {audience === "specific_its" && (
            <input value={testIts} onChange={(e) => setTestIts(e.target.value)} className={`${inputCls} mt-1 max-w-sm`} placeholder="ITS number(s), comma-separated" />
          )}
        </div>
      </div>

      {/* Button payloads */}
      <label className="mb-4 block">
        <span className={labelCls}>Button payloads (per-recipient; JSON)</span>
        <textarea value={buttonsJson} onChange={(e) => setButtonsJson(e.target.value)} rows={12} className={`${inputCls} font-mono text-xs`} spellCheck={false} />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={runPreview} disabled={previewing || !instanceId} className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800">
          {previewing ? "Previewing…" : "Preview audience"}
        </button>
        <button type="button" onClick={send} disabled={sending || !instanceId} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-700">
          {sending ? "Sending…" : "Send broadcast"}
        </button>
        {!instanceId && (
          <span className="text-xs text-amber-600 dark:text-amber-400">No registration instance for this date — create one on the Niyaz events page to send.</span>
        )}
      </div>

      {error && <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{error}</div>}
      {result && <div className="mt-3 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300">{result}</div>}

      {preview && (
        <div className="mt-4 rounded-md border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-950">
          <p className="mb-1 text-sm font-semibold">{preview.count} recipient(s){preview.unresolved.length ? ` · ${preview.unresolved.length} unresolved ITS` : ""}</p>
          {preview.sample.length > 0 && (
            <div className="max-h-60 overflow-auto text-sm">
              <table className="w-full text-left">
                <thead className="text-xs uppercase text-gray-400">
                  <tr>
                    <th className="px-2 py-1">Name</th>
                    <th className="px-2 py-1">ITS</th>
                    <th className="px-2 py-1">Phone</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.sample.map((r, i) => (
                    <tr key={i} className="border-t border-gray-100 dark:border-gray-800">
                      <td className="px-2 py-1">{r.name ?? "—"}</td>
                      <td className="px-2 py-1 font-mono text-xs text-gray-500">{r.its ?? "—"}</td>
                      <td className="px-2 py-1 font-mono text-xs text-gray-500">{r.phone_masked}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.count > preview.sample.length && (
                <p className="mt-1 px-2 text-xs text-gray-400">Showing first {preview.sample.length} of {preview.count}.</p>
              )}
            </div>
          )}
        </div>
      )}

      <BroadcastHistory refreshKey={historyRefresh} highlightId={lastBroadcastId} />
    </div>
  );
}
