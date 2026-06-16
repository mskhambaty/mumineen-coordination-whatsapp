"use client";

import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "@/lib/admin/client";
import BroadcastHistory from "@/components/admin/niyaz/BroadcastHistory";
import { formatNiyazEndTime } from "@/lib/rsvp/niyaz-format";

// ISO timestamp ↔ <input type="datetime-local"> value (browser-local wall clock).
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Day-level RSVP config + broadcast composer for one Niyaz day. Two templates are configured per day:
// the RSVP template (sent as the broadcast) and the RSVP confirmation template (sent back to a family
// by phase 2 after they respond, with a "change" button). Each has its own auto-discovered variable
// bindings + per-recipient button payloads; both are saved on the day (niyaz_event_config). Config is
// keyed by date; the broadcast runs against the day's representative registration instance.

type Config = {
  rsvpEventTitle: string | null;
  lunchMenu: string | null;
  dinnerMenu: string | null;
  rsvpEndTime: string | null;
  rsvpEndAt: string | null;
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
type MapField = { key: string; label: string };

// Roster fields offered for per-recipient ("Field") variable bindings (mirrors the Send Templates
// console; family_members is the computed family-member-names field).
const MAPPABLE: MapField[] = [
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

// Confirmation-only fields, computed per response at phase 2.
const CONFIRMATION_FIELDS: MapField[] = [
  { key: "rsvp_status", label: "RSVP status (Lunch n, Dinner n)" },
  { key: "lunch_attending_count", label: "Lunch count" },
  { key: "dinner_attending_count", label: "Dinner count" },
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
// fields for name/family_members/mumin_name, rsvp_status, else an empty static.
function defaultBinding(token: string, config: Config): Binding {
  const t = token.toLowerCase();
  if (t === "rsvp_event_title" || t === "event_title") return { kind: "static", value: config.rsvpEventTitle ?? "" };
  if (t === "lunch_menu" || t === "lunch") return { kind: "static", value: config.lunchMenu ?? "" };
  if (t === "dinner_menu" || t === "dinner") return { kind: "static", value: config.dinnerMenu ?? "" };
  if (t === "rsvp_end_time" || t === "end_time") return { kind: "static", value: formatNiyazEndTime(config.rsvpEndAt) || config.rsvpEndTime || "" };
  if (["name", "person_name", "full_name", "mumin_name"].includes(t)) return { kind: "field", field: "full_name" };
  if (t === "family_members") return { kind: "field", field: "family_members" };
  if (t === "rsvp_status") return { kind: "field", field: "rsvp_status" };
  return { kind: "static", value: "" };
}

type AudienceKey =
  | "all_hof"
  | "all_hof_unresponded"
  | "all_adults"
  | "all_adults_unresponded"
  | "all_adults_hof"
  | "specific_its";

const DEFAULT_TEMPLATE = "ashara_relay_double_rsvp";
const DEFAULT_CONFIRMATION_TEMPLATE = "ashara_relay_double_rsvp_confirmation";

// Default per-recipient button spec for ashara_relay_double_rsvp: a Flow button ("Attending") that
// opens the RSVP flow, and a quick-reply ("Not attending"). {{hof_its}}, {{RegistrationInstanceId}}
// and {{EligibleFamilyCount}} are substituted per recipient.
const DEFAULT_BUTTONS = JSON.stringify(
  [
    {
      type: "flow",
      index: 0,
      flow_token: "rsvp:{{hof_its}}:{{RegistrationInstanceId}}",
      flow_action_data: {
        lunch_attending_count: "{{EligibleFamilyCount}}",
        dinner_attending_count: "{{EligibleFamilyCount}}",
        hof_its: "{{hof_its}}",
        registration_instance_id: "{{RegistrationInstanceId}}",
      },
    },
    { type: "quick_reply", index: 1, payload: "rsvp:{{hof_its}}:{{RegistrationInstanceId}}:not-attending" },
  ],
  null,
  2,
);

// Default confirmation buttons: reopen the RSVP flow PRE-FILLED with the family's current counts so
// they can change their response; plus a not-attending quick-reply.
const DEFAULT_CONFIRMATION_BUTTONS = JSON.stringify(
  [
    {
      type: "flow",
      index: 0,
      flow_token: "rsvp:{{hof_its}}:{{RegistrationInstanceId}}",
      flow_action_data: {
        lunch_attending_count: "{{lunch_attending_count}}",
        dinner_attending_count: "{{dinner_attending_count}}",
        hof_its: "{{hof_its}}",
        registration_instance_id: "{{RegistrationInstanceId}}",
      },
    },
    { type: "quick_reply", index: 1, payload: "rsvp:{{hof_its}}:{{RegistrationInstanceId}}:not-attending" },
  ],
  null,
  2,
);

const inputCls =
  "block w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-950";

// Same look as inputCls but WITHOUT `block w-full`, so flex widths (w-28 / flex-1) on the inline
// binding-row controls aren't overridden into a tiny/expanded box.
const controlCls =
  "rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-950";

const labelCls = "text-xs uppercase tracking-wide text-gray-400";

// Map the audience radio to the broadcast API params. `testIts` carries the specific-ITS test list;
// `hofIts` carries the HOF ITS for the "all adults of a family" option.
function audienceParams(audience: AudienceKey, testIts: string, hofIts: string) {
  const split = (s: string) => s.split(/[\s,]+/).filter(Boolean);
  switch (audience) {
    case "specific_its":
      return { audience: "specific_its", level: "ind", its: split(testIts), require_registered: false, only_non_responders: false };
    case "all_adults_hof":
      return { audience: "all_adults_hof", level: "ind", its: split(hofIts), require_registered: false, only_non_responders: false };
    case "all_adults":
      return { audience: "all_adults", level: "ind", its: [] as string[], require_registered: false, only_non_responders: false };
    case "all_adults_unresponded":
      return { audience: "all_adults", level: "ind", its: [] as string[], require_registered: false, only_non_responders: true };
    case "all_hof_unresponded":
      return { audience: "all_hof", level: "fam", its: [] as string[], require_registered: false, only_non_responders: true };
    default:
      return { audience: "all_hof", level: "fam", its: [] as string[], require_registered: false, only_non_responders: false };
  }
}

// The body/header tokens of a selected template.
function templateTokens(templates: TemplatePreview[], templateCode: string | null) {
  const t = templates.find((x) => x.name === templateCode) ?? null;
  const body = extractTokens(t?.bodyText);
  const header = t?.header?.format === "TEXT" ? extractTokens(t.header.text)[0] ?? null : null;
  return { tpl: t, body, header, all: [...(header ? [header] : []), ...body.filter((x) => x !== header)] };
}

// One template's config block: dropdown + live preview + per-variable bindings + button-payload JSON.
function TemplateBindingEditor({
  label,
  templates,
  templateCode,
  onTemplateCode,
  config,
  bindings,
  setBinding,
  buttonsJson,
  setButtonsJson,
  mappable,
}: {
  label: string;
  templates: TemplatePreview[];
  templateCode: string | null;
  onTemplateCode: (v: string) => void;
  config: Config;
  bindings: Record<string, Binding>;
  setBinding: (tok: string, b: Binding) => void;
  buttonsJson: string;
  setButtonsJson: (v: string) => void;
  mappable: MapField[];
}) {
  const { tpl, all: allTokens } = templateTokens(templates, templateCode);
  const effBinding = (tok: string): Binding => bindings[tok] ?? defaultBinding(tok, config);
  const previewText = (text: string): string =>
    text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, tok: string) => {
      const b = effBinding(tok);
      return b.kind === "static" ? b.value || `{{${tok}}}` : `[${mappable.find((m) => m.key === b.field)?.label ?? b.field}]`;
    });

  return (
    <div className="mb-5 rounded-md border border-gray-200 p-3 dark:border-gray-800">
      <label className="block">
        <span className={labelCls}>{label}</span>
        <select value={templateCode ?? ""} onChange={(e) => onTemplateCode(e.target.value)} className={inputCls}>
          <option value="">— select a template —</option>
          {templateCode && !templates.some((t) => t.name === templateCode) && (
            <option value={templateCode}>{templateCode} (not in WABA)</option>
          )}
          {templates.map((t) => (
            <option key={t.name} value={t.name}>{t.name}</option>
          ))}
        </select>
      </label>

      {tpl && (tpl.bodyText || tpl.header?.text) && (
        <div className="mt-3">
          <span className={labelCls}>Preview</span>
          <div className="mt-1 max-w-md whitespace-pre-wrap rounded-lg border border-green-200 bg-green-50 p-3 text-sm shadow-sm dark:border-green-900 dark:bg-green-950/40">
            {tpl.header?.text && <p className="mb-1 font-semibold">{previewText(tpl.header.text)}</p>}
            {tpl.bodyText && <p>{previewText(tpl.bodyText)}</p>}
            {tpl.footerText && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{previewText(tpl.footerText)}</p>}
            {tpl.buttons.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1 border-t border-green-200 pt-2 dark:border-green-900">
                {tpl.buttons.map((b, i) => (
                  <span key={i} className="rounded border border-gray-300 bg-white px-2 py-0.5 text-xs text-blue-600 dark:border-gray-700 dark:bg-gray-900 dark:text-blue-400">
                    {b.text || b.type}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {allTokens.length > 0 && (
        <div className="mt-3">
          <span className={labelCls}>Variables</span>
          <div className="mt-1 space-y-2">
            {allTokens.map((tok) => {
              const b = effBinding(tok);
              return (
                <div key={tok} className="flex items-center gap-2">
                  <span className="w-44 shrink-0 truncate font-mono text-xs text-gray-600 dark:text-gray-300" title={tok}>{tok}</span>
                  <select
                    value={b.kind}
                    onChange={(e) => setBinding(tok, e.target.value === "field" ? { kind: "field", field: b.kind === "field" ? b.field : mappable[0].key } : { kind: "static", value: b.kind === "static" ? b.value : "" })}
                    className={`${controlCls} w-28 shrink-0`}
                  >
                    <option value="static">Static</option>
                    <option value="field">Field</option>
                  </select>
                  {b.kind === "static" ? (
                    <input value={b.value} onChange={(e) => setBinding(tok, { kind: "static", value: e.target.value })} placeholder="value for everyone" className={`${controlCls} min-w-0 flex-1`} />
                  ) : (
                    <select value={b.field} onChange={(e) => setBinding(tok, { kind: "field", field: e.target.value })} className={`${controlCls} min-w-0 flex-1`}>
                      {mappable.map((m) => (
                        <option key={m.key} value={m.key}>{m.label}</option>
                      ))}
                    </select>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <label className="mt-3 block">
        <span className={labelCls}>Button payloads (per-recipient; JSON)</span>
        <textarea value={buttonsJson} onChange={(e) => setButtonsJson(e.target.value)} rows={10} className={`${inputCls} font-mono text-xs`} spellCheck={false} />
      </label>
    </div>
  );
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
  const [config, setConfig] = useState<Config>({ rsvpEventTitle: "", lunchMenu: "", dinnerMenu: "", rsvpEndTime: "", rsvpEndAt: null, hasLunch: false, hasDinner: false, templateCode: DEFAULT_TEMPLATE });
  const [savingConfig, setSavingConfig] = useState(false);
  const [configSaved, setConfigSaved] = useState(false);
  const [templates, setTemplates] = useState<TemplatePreview[]>([]);

  // RSVP template bindings/buttons (sent as the broadcast).
  const [bindings, setBindings] = useState<Record<string, Binding>>({});
  const [buttonsJson, setButtonsJson] = useState(DEFAULT_BUTTONS);

  // Confirmation template config (persisted; sent reactively by phase 2).
  const [confTemplateCode, setConfTemplateCode] = useState<string | null>(DEFAULT_CONFIRMATION_TEMPLATE);
  const [confBindings, setConfBindings] = useState<Record<string, Binding>>({});
  const [confButtonsJson, setConfButtonsJson] = useState(DEFAULT_CONFIRMATION_BUTTONS);

  const [audience, setAudience] = useState<AudienceKey>("all_hof");
  const [testIts, setTestIts] = useState("");
  const [hofItsInput, setHofItsInput] = useState("");

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
    const c = data.config as (Config & { confirmationTemplateCode?: string | null; confirmationVariableBindings?: Record<string, Binding> | null; confirmationButtons?: unknown[] | null }) | null;
    if (c) {
      setConfig({
        rsvpEventTitle: c.rsvpEventTitle ?? "",
        lunchMenu: c.lunchMenu ?? "",
        dinnerMenu: c.dinnerMenu ?? "",
        rsvpEndTime: c.rsvpEndTime ?? "",
        rsvpEndAt: c.rsvpEndAt ?? null,
        hasLunch: c.hasLunch,
        hasDinner: c.hasDinner,
        templateCode: c.templateCode ?? DEFAULT_TEMPLATE,
      });
      setConfTemplateCode(c.confirmationTemplateCode ?? DEFAULT_CONFIRMATION_TEMPLATE);
      if (c.confirmationVariableBindings) setConfBindings(c.confirmationVariableBindings);
      if (c.confirmationButtons) setConfButtonsJson(JSON.stringify(c.confirmationButtons, null, 2));
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

  const setBinding = (tok: string, b: Binding) => setBindings((prev) => ({ ...prev, [tok]: b }));
  const setConfBinding = (tok: string, b: Binding) => setConfBindings((prev) => ({ ...prev, [tok]: b }));
  const effBinding = (tok: string): Binding => bindings[tok] ?? defaultBinding(tok, config);
  const effConfBinding = (tok: string): Binding => confBindings[tok] ?? defaultBinding(tok, config);

  // Flat token→binding map for a template's variables (used to persist the confirmation bindings).
  function flatBindings(templateCode: string | null, eff: (tok: string) => Binding): Record<string, Binding> {
    const { all } = templateTokens(templates, templateCode);
    return Object.fromEntries(all.map((t) => [t, eff(t)]));
  }

  function parseButtons(json: string): unknown[] | null {
    try {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  // Persist day config + both templates' confirmation config. Returns true on success.
  const persistConfig = useCallback(async (): Promise<boolean> => {
    const confButtons = parseButtons(confButtonsJson);
    if (confTemplateCode && confButtons === null) {
      setError("Confirmation button payloads are not valid JSON.");
      return false;
    }
    const res = await apiFetch(`/api/admin/niyaz/days/${date}`, {
      method: "PUT",
      body: JSON.stringify({
        rsvp_event_title: config.rsvpEventTitle || null,
        lunch_menu: config.lunchMenu || null,
        dinner_menu: config.dinnerMenu || null,
        rsvp_end_at: config.rsvpEndAt || null,
        has_lunch: config.hasLunch,
        has_dinner: config.hasDinner,
        template_code: config.templateCode || null,
        confirmation_template_code: confTemplateCode || null,
        confirmation_variable_bindings: confTemplateCode ? flatBindings(confTemplateCode, effConfBinding) : null,
        confirmation_buttons: confTemplateCode ? confButtons : null,
      }),
    });
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "Save failed");
      return false;
    }
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, config, confTemplateCode, confButtonsJson, confBindings, templates]);

  async function saveConfig() {
    setSavingConfig(true);
    setConfigSaved(false);
    setError(null);
    try {
      if (await persistConfig()) {
        setConfigSaved(true);
        onSaved?.();
      }
    } finally {
      setSavingConfig(false);
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
      const p = audienceParams(audience, testIts, hofItsInput);
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
    const buttons = parseButtons(buttonsJson);
    if (!buttons) {
      setError("RSVP button payloads are not valid JSON.");
      return;
    }
    setSending(true);
    setError(null);
    setResult(null);
    try {
      // Persist config first so the confirmation template is ready before any responses arrive.
      if (!(await persistConfig())) return;
      const { body, header } = templateTokens(templates, config.templateCode);
      const p = audienceParams(audience, testIts, hofItsInput);
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
          variable_bindings: {
            body: Object.fromEntries(body.map((t) => [t, effBinding(t)])),
            ...(header ? { header: effBinding(header) } : {}),
          },
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
        Configure this event and both templates, choose an audience, preview, then send. Sends go out from the niyaz
        RSVP number (determined by the template&apos;s WhatsApp account). The confirmation template is sent back to a
        family automatically after they respond.
      </p>

      {/* Day config */}
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
          <span className={labelCls}>RSVP end time / cutoff (Chicago time)</span>
          <input
            type="datetime-local"
            value={toLocalInput(config.rsvpEndAt)}
            onChange={(e) => setConfig({ ...config, rsvpEndAt: e.target.value ? new Date(e.target.value).toISOString() : null })}
            className={inputCls}
          />
          <span className="mt-0.5 block text-xs text-gray-400">Responses after this are rejected with a &quot;registration has ended&quot; reply. The {"{{rsvp_end_time}}"} variable shows {formatNiyazEndTime(config.rsvpEndAt) || "—"}.</span>
        </label>
        <div className="flex items-end gap-6">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={config.hasLunch} onChange={(e) => setConfig({ ...config, hasLunch: e.target.checked })} />
            Lunch
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={config.hasDinner} onChange={(e) => setConfig({ ...config, hasDinner: e.target.checked })} />
            Dinner
          </label>
        </div>
      </div>

      {/* RSVP template */}
      <TemplateBindingEditor
        label="RSVP Template"
        templates={templates}
        templateCode={config.templateCode}
        onTemplateCode={(v) => setConfig({ ...config, templateCode: v })}
        config={config}
        bindings={bindings}
        setBinding={setBinding}
        buttonsJson={buttonsJson}
        setButtonsJson={setButtonsJson}
        mappable={MAPPABLE}
      />

      {/* RSVP confirmation template */}
      <TemplateBindingEditor
        label="RSVP confirmation template (sent after a response)"
        templates={templates}
        templateCode={confTemplateCode}
        onTemplateCode={setConfTemplateCode}
        config={config}
        bindings={confBindings}
        setBinding={setConfBinding}
        buttonsJson={confButtonsJson}
        setButtonsJson={setConfButtonsJson}
        mappable={[...MAPPABLE, ...CONFIRMATION_FIELDS]}
      />

      <div className="mb-4 flex justify-end">
        <button type="button" onClick={saveConfig} disabled={savingConfig} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800">
          {savingConfig ? "Saving…" : configSaved ? "Saved ✓" : "Save config"}
        </button>
      </div>

      {/* Audience */}
      <div className="mb-4">
        <span className={labelCls}>Audience</span>
        <div className="mt-1 space-y-1 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="audience" checked={audience === "all_hof"} onChange={() => setAudience("all_hof")} />
            All HOF
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="audience" checked={audience === "all_hof_unresponded"} onChange={() => setAudience("all_hof_unresponded")} />
            All HOF — not responded to the day&apos;s niyaz RSVP
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="audience" checked={audience === "all_adults"} onChange={() => setAudience("all_adults")} />
            All Adults
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="audience" checked={audience === "all_adults_unresponded"} onChange={() => setAudience("all_adults_unresponded")} />
            All Adults — not responded to the day&apos;s niyaz RSVP
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="audience" checked={audience === "all_adults_hof"} onChange={() => setAudience("all_adults_hof")} />
            All Adults with HOF ITS ID
          </label>
          {audience === "all_adults_hof" && (
            <input value={hofItsInput} onChange={(e) => setHofItsInput(e.target.value)} className={`${inputCls} mt-1 max-w-sm`} placeholder="HOF ITS id" />
          )}
          <label className="flex items-center gap-2">
            <input type="radio" name="audience" checked={audience === "specific_its"} onChange={() => setAudience("specific_its")} />
            Test: specific ITS
          </label>
          {audience === "specific_its" && (
            <input value={testIts} onChange={(e) => setTestIts(e.target.value)} className={`${inputCls} mt-1 max-w-sm`} placeholder="ITS number(s), comma-separated" />
          )}
        </div>
      </div>

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
