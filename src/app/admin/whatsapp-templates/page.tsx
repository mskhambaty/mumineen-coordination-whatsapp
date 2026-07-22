"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { QueryBuilder, formatQuery, type Field, type RuleGroupType } from "react-querybuilder";
import "react-querybuilder/dist/query-builder.css";

import { RecentSetValueEditor } from "@/components/admin/RecentSetValueEditor";
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
  friendlyName: string | null;
  isActive: boolean;
  // The WhatsApp account/WABA/number this template belongs to (and is sent from).
  accountLabel: string;
  wabaId: string | null;
  phoneNumberId: string;
  displayNumber: string | null;
};
type AccountOption = { label: string; name: string; displayName: string | null; displayNumber: string | null; phoneNumberId: string };
type SegmentCount = { key: string; label: string; total: number; in_window: number; out_window: number };
type SelectableUser = { id: string; name: string; role: string };
type Preview = { total: number; in_window: number; out_window: number; est_cost_usd: number; recipients?: { phone: string; full_name: string | null; its: string | null; inWindow: boolean }[]; funnel?: { matched: number; with_whatsapp: number; unique: number } | null; csv_stats?: { parsed: number; skipped: number; duplicates: number; corrupted: number } | null };
type CatalogField = { key: string; label: string; group: string; type: string; operators: string[]; values: string[] };
type MappableField = { key: string; label: string };
type Binding = { kind: "static"; value: string } | { kind: "field"; field: string };
// rqb Field plus our marker for `set` fields, read by RecentSetValueEditor (avoids an `as Field` cast).
type RqbField = Field & { setField?: boolean };
type SavedBindings = { body?: Record<string, Binding>; header?: Binding; urlButton?: Binding; headerMediaUrl?: string };
type BroadcastAudit = {
  audience_key: string;
  audience_rules: RuleGroupType | null;
  variable_bindings: SavedBindings | null;
  window_filter: string | null;
  window_hours: number | null;
  selected_user_ids: string[] | null;
};
type FullRecipient = { phone: string; name: string | null; its: string | null; status: string; was_in_window: boolean | null; sent_at: string | null; detail: string | null };
type Broadcast = {
  id: string;
  message_kind?: string | null;
  template_code: string | null;
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
  { key: "segment_all_users", label: "Segment: All users (registered + unregistered RSVP)" },
  { key: "segment_hof", label: "Segment: Heads of family (registered + unregistered RSVP)" },
  { key: "segment_hof_unresponded", label: "Segment: HOF — no RSVP response & no prior template" },
  { key: "custom", label: "Custom filter…" },
  { key: "csv_upload", label: "Upload CSV…" },
];

// Display label for a template in the pickers: friendly name when set, else the raw Meta name.
function tplLabel(t: TemplateDescriptor): string {
  return t.friendlyName?.trim() || t.name;
}

// Human-readable handle for the number a template sends from: its display number when known, else
// the account label. Shown only when more than one WhatsApp account is configured.
function accountTag(t: TemplateDescriptor): string {
  return t.displayNumber?.trim() || t.accountLabel;
}

// Stable identity for a template across accounts. Two WABAs can hold a same-named template, so name
// alone isn't unique — key React lists and per-row state by (account, name, language).
function tplKey(t: TemplateDescriptor): string {
  return `${t.accountLabel}/${t.name}/${t.language}`;
}

const OP_LABELS: Record<string, string> = {
  "=": "is", "!=": "is not", in: "is any of", notIn: "is none of", contains: "contains",
  null: "is empty", notNull: "is not empty", "<": "before / <", "<=": "≤", ">": "after / >", ">=": "≥", between: "between",
};

const input = "rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900";

export default function SendTemplatesPage() {
  const [mode, setMode] = useState<"broadcast" | "single">("broadcast");
  const [templates, setTemplates] = useState<TemplateDescriptor[]>([]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [account, setAccount] = useState<string>(""); // selected sending number (phoneNumberId)
  const [users, setUsers] = useState<SelectableUser[]>([]);
  const [segments, setSegments] = useState<SegmentCount[]>([]);
  const [windowHours, setWindowHours] = useState<number>(24); // configured free-window size (WHATSAPP_WINDOW_HOURS)
  const [manageOpen, setManageOpen] = useState(false);
  const [undeliverableOpen, setUndeliverableOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Broadcast state
  const [broadcastKind, setBroadcastKind] = useState<"template" | "text">("template");
  const [broadcastText, setBroadcastText] = useState("");
  const [tpl, setTpl] = useState<string>("");
  const [audience, setAudience] = useState<string>("selected_users");
  const [windowFilter, setWindowFilter] = useState<"all" | "in_window" | "out_window">("all");
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [csvText, setCsvText] = useState<string>(""); // raw text of an uploaded audience CSV
  const [csvFileName, setCsvFileName] = useState<string>("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [busy, setBusy] = useState(false);
  const [draining, setDraining] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ broadcast: BroadcastAudit; status_counts: Record<string, number>; failure_reasons: Record<string, number> } | null>(null);
  const [failures, setFailures] = useState<{ phone: string; name: string | null; its: string | null; was_in_window: boolean | null; reason: string }[] | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [recipients, setRecipients] = useState<FullRecipient[] | null>(null);
  const [recipientsLoading, setRecipientsLoading] = useState(false);

  // Custom audience + variable bindings
  const [query, setQuery] = useState<RuleGroupType>({ combinator: "and", rules: [] });
  const [catalog, setCatalog] = useState<CatalogField[]>([]);
  const [mappable, setMappable] = useState<MappableField[]>([]);
  const [bindings, setBindings] = useState<Record<string, Binding>>({}); // token | "__header" | "__urlButton"
  const [headerMediaUrl, setHeaderMediaUrl] = useState("");
  const [viewQuery, setViewQuery] = useState(false);
  const [previewedFor, setPreviewedFor] = useState<string | null>(null);

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

  // Manually push any pending recipients through the send pipeline (the cron is a backstop, not a
  // dependency). Unsticks broadcasts left in 'running' when the minute cron isn't firing.
  const drainPending = useCallback(async () => {
    setDraining(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch("/api/admin/templates/drain", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Drain failed");
      setNotice(`Drain complete: ${data.processed} sent across ${data.batches} batch(es).`);
      await loadBroadcasts();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Drain failed");
    } finally {
      setDraining(false);
    }
  }, [loadBroadcasts]);

  // Expand a broadcast row to show its delivery-status rollup, grouped failure reasons, and (if any
  // failed) the per-recipient failure list.
  async function toggleDetail(b: Broadcast) {
    if (expanded === b.id) {
      setExpanded(null);
      setDetail(null);
      setFailures(null);
      setRecipients(null);
      return;
    }
    setExpanded(b.id);
    setDetail(null);
    setFailures(null);
    setRecipients(null);
    setDetailLoading(true);
    try {
      const res = await apiFetch(`/api/admin/templates/broadcasts/${b.id}`);
      if (res.ok) {
        const data = await res.json();
        const bc = (data.broadcast ?? {}) as Partial<BroadcastAudit>;
        setDetail({
          broadcast: {
            audience_key: bc.audience_key ?? b.audience_key,
            audience_rules: bc.audience_rules ?? null,
            variable_bindings: bc.variable_bindings ?? null,
            window_filter: bc.window_filter ?? null,
            window_hours: bc.window_hours ?? null,
            selected_user_ids: bc.selected_user_ids ?? null,
          },
          status_counts: data.status_counts ?? {},
          failure_reasons: data.failure_reasons ?? {},
        });
      }
      if (b.count_failed > 0) {
        const fr = await apiFetch(`/api/admin/templates/broadcasts/${b.id}/failures`);
        if (fr.ok) setFailures((await fr.json()).failures ?? []);
      }
    } finally {
      setDetailLoading(false);
    }
  }

  // Lazy-load the full recipient list (all statuses) for a broadcast — PII, so fetched only on demand.
  async function loadRecipients(id: string) {
    setRecipientsLoading(true);
    try {
      const r = await apiFetch(`/api/admin/templates/broadcasts/${id}/recipients`);
      if (r.ok) setRecipients(((await r.json()).recipients as FullRecipient[]) ?? []);
    } finally {
      setRecipientsLoading(false);
    }
  }

  const WINDOW_LABELS: Record<string, string> = { all: "All recipients", in_window: "Conversed (free)", out_window: "Not conversed (paid)" };

  const loadTemplates = useCallback(async () => {
    const res = await apiFetch("/api/admin/templates");
    if (res.ok) {
      const data = await res.json();
      setTemplates((data.templates as TemplateDescriptor[]) ?? []);
      setUsers((data.selectable_users as SelectableUser[]) ?? []);
      return true;
    }
    setError("You don't have access to this page, or templates failed to load.");
    return false;
  }, []);

  // Load the configured WhatsApp sending numbers for the "Send from" picker. Default the selection to
  // the first account so free-text sends (which need an explicit number) always have one, even in
  // single-account deployments where the picker stays hidden.
  const loadAccounts = useCallback(async () => {
    const res = await apiFetch("/api/admin/whatsapp/accounts");
    if (res.ok) {
      const list = ((await res.json()).accounts as AccountOption[]) ?? [];
      setAccounts(list);
      setAccount((prev) => prev || list[0]?.phoneNumberId || "");
    }
  }, []);

  // Load the header reach-segment sizes. `hours` overrides the free-window size; when omitted we
  // adopt the server's configured default (WHATSAPP_WINDOW_HOURS) as the editable starting value.
  const loadSegments = useCallback(async (hours?: number) => {
    const qs = typeof hours === "number" ? `?hours=${hours}` : "";
    const res = await apiFetch(`/api/admin/templates/segments${qs}`);
    if (res.ok) {
      const data = await res.json();
      setSegments((data.segments as SegmentCount[]) ?? []);
      if (hours === undefined && typeof data.window_hours === "number") setWindowHours(data.window_hours);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await loadTemplates();
      const f = await apiFetch("/api/admin/templates/audience-fields");
      if (f.ok) {
        const fd = await f.json();
        setCatalog((fd.fields as CatalogField[]) ?? []);
        setMappable((fd.mappableFields as MappableField[]) ?? []);
      }
      await Promise.all([loadBroadcasts(), loadSegments(), loadAccounts()]);
    })();
  }, [loadBroadcasts, loadTemplates, loadSegments, loadAccounts]);

  // Templates offered in the pickers: active only (deactivated ones are managed in the popup).
  const activeTemplates = useMemo(() => templates.filter((t) => t.isActive), [templates]);
  // Only surface the sending-number controls when more than one WhatsApp account exists — keeps the
  // single-number deployment's UI unchanged.
  const multiAccount = accounts.length > 1;
  // When a sending number is chosen (multi-account), narrow the template pickers to that number's
  // templates — a template can only be sent from the WABA that owns it.
  const accountTemplates = useMemo(
    () => (multiAccount && account ? activeTemplates.filter((t) => t.phoneNumberId === account) : activeTemplates),
    [activeTemplates, account, multiAccount],
  );

  const selectedTpl = templates.find((t) => t.name === tpl) ?? null;
  const selectedSingleTpl = templates.find((t) => t.name === singleTpl) ?? null;
  const dynamicUrlBtn = selectedTpl?.urlButtons.find((b) => b.hasVar) ?? null;

  const rqbFields: RqbField[] = useMemo(
    () =>
      catalog.map((f): RqbField => {
        const base = { name: f.key, label: `${f.group}: ${f.label}`, operators: f.operators.map((o) => ({ name: o, label: OP_LABELS[o] ?? o })) };
        if (f.type === "bool") return { ...base, valueEditorType: "select" as const, values: [{ name: "true", label: "Yes" }, { name: "false", label: "No" }], defaultValue: "true" };
        if (f.type === "enum") return { ...base, valueEditorType: "multiselect" as const, values: f.values.map((v) => ({ name: v, label: v })) };
        // set: a recency-windowed multiselect rendered by RecentSetValueEditor (keyed off `setField`).
        if (f.type === "set") return { ...base, setField: true, values: f.values.map((v) => ({ name: v, label: v })) };
        if (f.type === "number") return { ...base, inputType: "number" };
        if (f.type === "date") return { ...base, inputType: "date" };
        return base;
      }),
    [catalog],
  );

  // Human-readable + equivalent-SQL views of the current rule tree (the audience is evaluated
  // in-app; the SQL is shown for transparency only).
  const filterSummary = useMemo(() => {
    try {
      return formatQuery(query, { format: "natural_language", fields: rqbFields }) || "all people";
    } catch {
      return "all people";
    }
  }, [query, rqbFields]);
  const filterSql = useMemo(() => {
    try {
      return formatQuery(query, { format: "sql", fields: rqbFields });
    } catch {
      return "";
    }
  }, [query, rqbFields]);

  // Plain-language description of the expanded broadcast's saved rule tree (set-field compound values
  // render approximately — fine for a history summary). Memoized like filterSummary so the
  // formatQuery(... rqbFields) call stays inside a memo, keeping rqbFields's memoization preservable.
  const auditRulesText = useMemo(() => {
    const rules = detail?.broadcast.audience_rules;
    if (!rules) return "";
    try {
      return formatQuery(rules, { format: "natural_language", fields: rqbFields }) || "";
    } catch {
      return "(could not render rules)";
    }
  }, [detail, rqbFields]);

  // Switching the sending number invalidates any template chosen for the previous number, so clear the
  // template selections and the preview.
  function changeAccount(phoneNumberId: string) {
    setAccount(phoneNumberId);
    setTpl("");
    setSingleTpl("");
    setBindings({});
    setPreview(null);
  }

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
    if (audience === "csv_upload" && !csvText) return setError("Choose a CSV file first.");
    setBusy(true);
    try {
      const res = await apiFetch("/api/admin/templates/preview", {
        method: "POST",
        body: JSON.stringify({ audience_key: audience, selected_user_ids: selectedUsers, rules: audience === "custom" ? query : undefined, csv: audience === "csv_upload" ? csvText : undefined, window: windowFilter, window_hours: windowHours, include_recipients: true, limit: 50 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Preview failed");
      setPreview(data as Preview);
      setPreviewedFor(
        audience === "custom"
          ? filterSummary
          : audience === "csv_upload"
            ? `Uploaded CSV (${csvFileName || "file"})`
            : (AUDIENCES.find((a) => a.key === audience)?.label ?? audience),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setBusy(false);
    }
  }

  async function exportCsv() {
    setError(null);
    if (audience === "csv_upload" && !csvText) return setError("Choose a CSV file first.");
    setBusy(true);
    try {
      const res = await apiFetch("/api/admin/templates/audience-export", {
        method: "POST",
        body: JSON.stringify({ audience_key: audience, selected_user_ids: selectedUsers, rules: audience === "custom" ? query : undefined, csv: audience === "csv_upload" ? csvText : undefined, window: windowFilter, window_hours: windowHours }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Export failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `audience-${audience}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    const isText = broadcastKind === "text";
    if (isText) {
      if (!broadcastText.trim()) return setError("Enter a message.");
      if (!account) return setError("Pick a sending number.");
    } else if (!selectedTpl) {
      return setError("Pick a template.");
    }
    if (!preview) return setError("Run a preview first.");
    const what = isText ? "this free-text message" : `"${selectedTpl!.name}"`;
    const ok = window.confirm(
      isText
        ? `Send ${what} to ${preview.in_window} recipient(s) inside the ${windowHours}h window (free)? ` +
            `Recipients outside the window can't receive free text and are not included.`
        : `Send ${what} to ${preview.total} recipients ` +
            `(${preview.in_window} free, ${preview.out_window} paid ≈ $${preview.est_cost_usd})?`,
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch("/api/admin/templates/send", {
        method: "POST",
        body: JSON.stringify({
          message_kind: broadcastKind,
          phone_number_id: account || undefined,
          template_code: isText ? undefined : selectedTpl!.name,
          template_language: isText ? undefined : selectedTpl!.language,
          text: isText ? broadcastText.trim() : undefined,
          audience_key: audience,
          selected_user_ids: selectedUsers,
          rules: audience === "custom" ? query : undefined,
          csv: audience === "csv_upload" ? csvText : undefined,
          window: windowFilter,
          window_hours: windowHours,
          variable_bindings: isText ? undefined : buildBindingsPayload(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Send failed");
      setNotice(`Started: ${data.total} queued (${data.free} free / ${data.paid} paid${data.skipped ? `, ${data.skipped} skipped` : ""}). Draining in batches…`);
      setPreview(null);
      if (broadcastKind === "text") setBroadcastText("");
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
          ? { its: recipient.trim(), kind: "text", text: singleText.trim(), phone_number_id: account || undefined }
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

      {/* Reach segments: how many people each segment needs, split into "messaged in last 24h"
          (free session reply — no template needed) vs "paid" (needs a template — counts against the
          ~250/day Meta cap). */}
      {segments.length > 0 && (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {segments.map((s) => (
            <div key={s.key} className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400">{s.label}</div>
              <div className="mt-1 text-2xl font-bold">{s.total.toLocaleString()}</div>
              <div className="mt-1 text-xs">
                <span className="text-green-600">{s.in_window.toLocaleString()} messaged ≤{windowHours}h (free)</span>
                {" · "}
                <span className="text-amber-600">{s.out_window.toLocaleString()} need a template</span>
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="mt-1 text-xs text-gray-400">
        “Need a template” counts against Meta’s ~250 template messages/day cap; people who messaged in the last {windowHours}h can be answered for free without a template.
      </p>

      <div className="mt-3 flex gap-2">
        <button type="button" onClick={() => setMode("broadcast")} className={`rounded-md px-3 py-1.5 text-sm font-medium ${mode === "broadcast" ? "bg-blue-600 text-white" : "border border-gray-300 dark:border-gray-700"}`}>
          Broadcast
        </button>
        <button type="button" onClick={() => setMode("single")} className={`rounded-md px-3 py-1.5 text-sm font-medium ${mode === "single" ? "bg-blue-600 text-white" : "border border-gray-300 dark:border-gray-700"}`}>
          Single recipient
        </button>
      </div>

      {multiAccount && (
        <label className="mt-3 block max-w-sm text-xs uppercase tracking-wide text-gray-400">
          Send from
          <select value={account} onChange={(e) => changeAccount(e.target.value)} className={`${input} mt-1 block w-full`}>
            {accounts.map((a) => (
              <option key={a.phoneNumberId} value={a.phoneNumberId}>
                {a.name}{a.displayNumber && a.displayName ? ` (${a.displayNumber})` : ""}
              </option>
            ))}
          </select>
        </label>
      )}

      {error && <div className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950">{error}</div>}
      {notice && <div className="mt-3 rounded-md bg-green-50 p-3 text-sm text-green-700 dark:bg-green-950">{notice}</div>}

      {mode === "broadcast" ? (
        <section className="mt-5 space-y-4 rounded-lg border border-gray-200 p-4 dark:border-gray-800">
          <div className="flex gap-2">
            <button type="button" onClick={() => { setBroadcastKind("template"); setPreview(null); }} className={`rounded-md px-3 py-1.5 text-sm font-medium ${broadcastKind === "template" ? "bg-blue-600 text-white" : "border border-gray-300 dark:border-gray-700"}`}>Template</button>
            <button type="button" onClick={() => { setBroadcastKind("text"); setWindowFilter("in_window"); setPreview(null); }} className={`rounded-md px-3 py-1.5 text-sm font-medium ${broadcastKind === "text" ? "bg-blue-600 text-white" : "border border-gray-300 dark:border-gray-700"}`}>Free text</button>
          </div>

          {broadcastKind === "text" ? (
            <div>
              <textarea value={broadcastText} onChange={(e) => setBroadcastText(e.target.value)} rows={4} placeholder="Message…" className={`${input} block w-full`} />
              <p className="mt-1 text-xs text-amber-600">Free text only reaches people who messaged you within the last {windowHours}h; everyone outside that window can&apos;t receive it and is excluded. The audience is locked to the free window below.</p>
            </div>
          ) : (
          <>
          <div className="flex items-end justify-between gap-2">
            <label className="block flex-1 text-xs uppercase tracking-wide text-gray-400">
              Template
              <select value={tpl} onChange={(e) => selectBroadcastTemplate(e.target.value)} className={`${input} mt-1 block w-full`}>
                <option value="">Select a template…</option>
                {accountTemplates.map((t) => (
                  <option key={tplKey(t)} value={t.name}>
                    {tplLabel(t)} ({t.language}){multiAccount && !account ? ` · ${accountTag(t)}` : ""}{t.bodyVarCount > 0 ? " — has variables" : ""}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" onClick={() => setManageOpen(true)} className="shrink-0 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium dark:border-gray-700">
              Manage templates
            </button>
          </div>

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
          </>
          )}

          <label className="block text-xs uppercase tracking-wide text-gray-400">
            Audience
            <select value={audience} onChange={(e) => { setAudience(e.target.value); setPreview(null); }} className={`${input} mt-1 block w-full`}>
              {AUDIENCES.map((a) => (
                <option key={a.key} value={a.key}>{a.label}</option>
              ))}
            </select>
          </label>

          {/* Restrict the chosen audience to one side of the customer-service window: people who
              messaged us within the window (free session reply) vs those who didn't (paid template).
              The window size defaults to WHATSAPP_WINDOW_HOURS (24) but is editable here per send. */}
          <div className="flex flex-wrap items-start gap-3">
            <label className="block min-w-[12rem] flex-1 text-xs uppercase tracking-wide text-gray-400">
              Conversation window
              <select value={windowFilter} disabled={broadcastKind === "text"} onChange={(e) => { setWindowFilter(e.target.value as typeof windowFilter); setPreview(null); }} className={`${input} mt-1 block w-full disabled:opacity-60`}>
                <option value="all">All recipients</option>
                <option value="in_window">Conversed ≤{windowHours}h (free)</option>
                <option value="out_window">Not conversed (paid)</option>
              </select>
            </label>
            <label className="block w-28 text-xs uppercase tracking-wide text-gray-400">
              Window (hours)
              <input
                type="number"
                min={1}
                step={1}
                value={windowHours}
                onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n) && n > 0) { setWindowHours(Math.round(n)); setPreview(null); } }}
                onBlur={() => { void loadSegments(windowHours); }}
                className={`${input} mt-1 block w-full`}
              />
            </label>
          </div>
          <span className="block text-[11px] text-gray-400">Restricts the audience to people who did / didn’t message us in the last {windowHours}h. Defaults to 24h (WhatsApp’s free window); lower it for a conservative margin, or raise it to include older conversations. Updating it re-counts the header segments.</span>

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

          {audience === "csv_upload" && (
            <div className="rounded-md border border-gray-100 p-3 text-sm dark:border-gray-800">
              <div className="mb-2 text-xs uppercase tracking-wide text-gray-400">Upload CSV</div>
              <div className="mb-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300">
                Same format as the <b>Export CSV</b> (or a broadcast&apos;s failures CSV). A <b>WhatsApp</b> column is
                required; other columns (Name, ITS, …) are optional and used for personalization. Rows are
                <b> deduplicated by number</b>.{" "}
                <b>Don&apos;t open &amp; re-save the file in Excel</b> — it corrupts phone numbers to <code>9.17869E+11</code>;
                upload the download as-is.
              </div>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  setPreview(null);
                  if (!file) {
                    setCsvText("");
                    setCsvFileName("");
                    return;
                  }
                  setCsvFileName(file.name);
                  setCsvText(await file.text());
                }}
                className="block w-full text-sm"
              />
              {csvFileName && <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">Loaded: <b>{csvFileName}</b>. Run a preview to validate and see counts.</div>}
            </div>
          )}

          {audience === "custom" && (
            <div className="rounded-md border border-gray-100 p-3 text-sm dark:border-gray-800">
              <div className="mb-2 text-xs uppercase tracking-wide text-gray-400">Custom filter</div>
              <div className="mb-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300">
                This audience is everyone matching the filter <b>who has a valid WhatsApp number</b>, <b>deduplicated by number</b> (one message per number — relatives sharing a number are messaged once). So it can be lower than the people counts on the registration analytics page.
              </div>
              <QueryBuilder fields={rqbFields} query={query} onQueryChange={setQuery} controlElements={{ valueEditor: RecentSetValueEditor }} listsAsArrays />
              <div className="mt-2 text-xs text-gray-600 dark:text-gray-300">
                <span className="text-gray-400">Filter:</span> {filterSummary}
              </div>
              <button type="button" onClick={() => setViewQuery((v) => !v)} className="mt-2 text-xs text-blue-600 hover:underline">
                {viewQuery ? "Hide query" : "View query"}
              </button>
              {viewQuery && (
                <div className="mt-2 space-y-2">
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-gray-400">Equivalent SQL <span className="normal-case">(for reference — evaluated in-app, not run as SQL)</span></div>
                    <pre className="mt-1 overflow-auto rounded-md bg-gray-100 p-2 text-[11px] dark:bg-gray-950">{filterSql || "(no conditions)"}</pre>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-gray-400">Rule JSON</div>
                    <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-gray-100 p-2 text-[11px] dark:bg-gray-950">{JSON.stringify(query, null, 2)}</pre>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-3">
            <button type="button" onClick={runPreview} disabled={busy} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium disabled:opacity-50 dark:border-gray-700">
              Preview audience
            </button>
            <button type="button" onClick={exportCsv} disabled={busy} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium disabled:opacity-50 dark:border-gray-700" title={audience === "csv_upload" ? "Download the resolved audience: deduped, roster-enriched, with free/paid labels" : undefined}>
              {audience === "csv_upload" ? "Export resolved CSV" : "Export CSV"}
            </button>
            {preview && (
              <span className="text-sm">
                <b>{preview.total}</b> recipients · <span className="text-green-600">{preview.in_window} free</span> · <span className="text-amber-600">{preview.out_window} paid</span> ≈ <b>${preview.est_cost_usd}</b>
              </span>
            )}
          </div>

          {preview && (
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {preview.funnel && (
                <div>
                  {preview.funnel.matched.toLocaleString()} matched · {preview.funnel.with_whatsapp.toLocaleString()} with WhatsApp · <b>{preview.funnel.unique.toLocaleString()} unique numbers</b>{" "}
                  ({(preview.funnel.matched - preview.funnel.with_whatsapp).toLocaleString()} no number, {(preview.funnel.with_whatsapp - preview.funnel.unique).toLocaleString()} shared)
                </div>
              )}
              {preview.csv_stats && (
                <div>
                  {preview.csv_stats.parsed.toLocaleString()} rows · <b>{preview.total.toLocaleString()} unique numbers</b>
                  {preview.csv_stats.duplicates > 0 ? ` · ${preview.csv_stats.duplicates.toLocaleString()} duplicate${preview.csv_stats.duplicates === 1 ? "" : "s"}` : ""}
                  {preview.csv_stats.skipped > 0 ? ` · ${preview.csv_stats.skipped.toLocaleString()} skipped (no/short number)` : ""}
                  {preview.csv_stats.corrupted > 0 ? (
                    <span className="text-red-600"> · {preview.csv_stats.corrupted.toLocaleString()} corrupted by Excel (re-export without opening in Excel)</span>
                  ) : ""}
                </div>
              )}
              {previewedFor && (
                <div className="mt-0.5">Showing recipients for: <span className="text-gray-700 dark:text-gray-300">{previewedFor}</span></div>
              )}
            </div>
          )}

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

          <button type="button" onClick={send} disabled={busy || !preview || (broadcastKind === "text" ? !broadcastText.trim() : !selectedTpl)} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
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
                {accountTemplates.map((t) => (
                  <option key={tplKey(t)} value={t.name}>{tplLabel(t)} ({t.language}){multiAccount && !account ? ` · ${accountTag(t)}` : ""}</option>
                ))}
              </select>
              {selectedSingleTpl && multiAccount && (
                <p className="text-xs text-gray-500">Sends from {accountTag(selectedSingleTpl)}.</p>
              )}
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
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setUndeliverableOpen(true)}
              className="text-sm text-blue-600"
              title="Numbers auto-skipped because they aren't on WhatsApp / can't receive"
            >
              Undeliverable numbers
            </button>
            <button
              type="button"
              onClick={drainPending}
              disabled={draining}
              className="text-sm text-blue-600 disabled:opacity-50"
              title="Push any pending recipients through now (don't wait for the cron)"
            >
              {draining ? "Sending…" : "Send pending"}
            </button>
            <button type="button" onClick={loadBroadcasts} className="text-sm text-blue-600">Refresh</button>
          </div>
        </div>
        <p className="mt-1 text-xs text-gray-500">Tip: click a row to see delivery status and failures.</p>
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
              {broadcasts.map((b) => {
                const pending = b.total_recipients - b.count_sent - b.count_failed - (b.count_skipped ?? 0);
                return (
                  <Fragment key={b.id}>
                    <tr
                      className="cursor-pointer border-t border-gray-100 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900/50"
                      onClick={() => toggleDetail(b)}
                    >
                      <td className="px-2 py-1.5 font-mono text-xs">{expanded === b.id ? "▾ " : "▸ "}{b.message_kind === "text" ? "Free text" : b.template_code}</td>
                      <td className="px-2 py-1.5">{b.audience_key}</td>
                      <td className="px-2 py-1.5">
                        {b.status}
                        {b.status === "running" && pending > 0 ? <span className="text-amber-600"> · {pending} pending</span> : null}
                      </td>
                      <td className="px-2 py-1.5">{b.count_sent}/{b.total_recipients}{b.count_failed > 0 ? <span className="text-red-600"> ({b.count_failed} failed)</span> : null}</td>
                      <td className="px-2 py-1.5">{b.count_free}/{b.count_paid}</td>
                      <td className="px-2 py-1.5">{b.count_skipped ?? 0}</td>
                      <td className="px-2 py-1.5">${b.est_cost_usd}</td>
                      <td className="px-2 py-1.5 text-xs text-gray-500">{new Date(b.started_at).toLocaleString()}</td>
                    </tr>
                    {expanded === b.id && (
                      <tr className="border-t border-gray-100 bg-gray-50 dark:border-gray-800 dark:bg-gray-900/40">
                        <td colSpan={8} className="px-4 py-3">
                          {detailLoading && <p className="text-xs text-gray-500">Loading…</p>}
                          {!detailLoading && detail && (
                            <div className="space-y-2 text-xs">
                              {/* How this audience was defined: preset/custom, the conversation-window
                                  toggle + hours, the saved rule tree, and the variable bindings. */}
                              <div className="rounded border border-gray-200 p-2 dark:border-gray-700">
                                <div className="font-semibold text-gray-600 dark:text-gray-300">Audience &amp; filters</div>
                                <div className="mt-1 space-y-0.5 text-gray-600 dark:text-gray-400">
                                  <div>Audience: <span className="text-gray-800 dark:text-gray-200">{AUDIENCES.find((a) => a.key === detail.broadcast.audience_key)?.label ?? detail.broadcast.audience_key}</span>
                                    {detail.broadcast.selected_user_ids?.length ? ` (${detail.broadcast.selected_user_ids.length} user${detail.broadcast.selected_user_ids.length === 1 ? "" : "s"})` : ""}
                                  </div>
                                  <div>Window: <span className="text-gray-800 dark:text-gray-200">{detail.broadcast.window_filter ? (WINDOW_LABELS[detail.broadcast.window_filter] ?? detail.broadcast.window_filter) : "not recorded"}</span>
                                    {detail.broadcast.window_hours ? ` · ${detail.broadcast.window_hours}h` : detail.broadcast.window_filter ? " · default hours" : ""}
                                  </div>
                                  {detail.broadcast.audience_rules && (
                                    <div>Filter: <span className="text-gray-800 dark:text-gray-200">{auditRulesText}</span></div>
                                  )}
                                  {detail.broadcast.variable_bindings?.body && Object.keys(detail.broadcast.variable_bindings.body).length > 0 && (
                                    <div>Variables: <span className="text-gray-800 dark:text-gray-200">
                                      {Object.entries(detail.broadcast.variable_bindings.body).map(([tok, b]) => `${tok}=${b.kind === "static" ? `"${b.value}"` : `[${b.field}]`}`).join(", ")}
                                    </span></div>
                                  )}
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-x-4 gap-y-1">
                                {Object.entries(detail.status_counts).map(([k, v]) => (
                                  <span key={k}><span className="font-semibold">{v}</span> {k}</span>
                                ))}
                              </div>
                              {Object.keys(detail.failure_reasons).length > 0 && (
                                <div>
                                  <div className="flex items-center justify-between">
                                    <span className="font-semibold text-red-600">Failures</span>
                                    <a
                                      href={`/api/admin/templates/broadcasts/${b.id}/failures?format=csv`}
                                      className="text-blue-600"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      Download failed (CSV)
                                    </a>
                                  </div>
                                  <ul className="mt-1 list-inside list-disc text-gray-600 dark:text-gray-400">
                                    {Object.entries(detail.failure_reasons).map(([reason, n]) => (
                                      <li key={reason}><span className="font-semibold">{n}</span> × {reason}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              {failures && failures.length > 0 && (
                                <div className="mt-2 max-h-64 overflow-auto rounded border border-gray-200 dark:border-gray-700">
                                  <table className="w-full text-left text-xs">
                                    <thead className="bg-gray-100 text-gray-500 dark:bg-gray-800">
                                      <tr>
                                        <th className="px-2 py-1">Name</th>
                                        <th className="px-2 py-1">ITS</th>
                                        <th className="px-2 py-1">WhatsApp</th>
                                        <th className="px-2 py-1">Reason</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {failures.map((f, i) => (
                                        <tr key={`${f.phone}-${i}`} className="border-t border-gray-100 dark:border-gray-800">
                                          <td className="px-2 py-1">{f.name ?? "—"}</td>
                                          <td className="px-2 py-1 font-mono">{f.its ?? "—"}</td>
                                          <td className="px-2 py-1 font-mono">{f.phone}</td>
                                          <td className="px-2 py-1">{f.reason}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}

                              {/* Full audience this broadcast sent to (every status) — loaded on demand (PII). */}
                              <div className="mt-2">
                                <div className="flex items-center justify-between">
                                  <span className="font-semibold text-gray-600 dark:text-gray-300">Recipients (full audience)</span>
                                  <div className="flex items-center gap-3">
                                    {recipients === null && (
                                      <button type="button" onClick={(e) => { e.stopPropagation(); void loadRecipients(b.id); }} disabled={recipientsLoading} className="text-blue-600 disabled:opacity-50">
                                        {recipientsLoading ? "Loading…" : "Show full audience"}
                                      </button>
                                    )}
                                    <a href={`/api/admin/templates/broadcasts/${b.id}/recipients?format=csv`} className="text-blue-600" onClick={(e) => e.stopPropagation()}>
                                      Download full audience (CSV)
                                    </a>
                                  </div>
                                </div>
                                {recipients && (
                                  <div className="mt-1 max-h-64 overflow-auto rounded border border-gray-200 dark:border-gray-700">
                                    <table className="w-full text-left text-xs">
                                      <thead className="sticky top-0 bg-gray-100 text-gray-500 dark:bg-gray-800">
                                        <tr>
                                          <th className="px-2 py-1">Name</th>
                                          <th className="px-2 py-1">ITS</th>
                                          <th className="px-2 py-1">WhatsApp</th>
                                          <th className="px-2 py-1">Status</th>
                                          <th className="px-2 py-1">Window</th>
                                          <th className="px-2 py-1">Detail</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {recipients.map((r, i) => (
                                          <tr key={`${r.phone}-${i}`} className="border-t border-gray-100 dark:border-gray-800">
                                            <td className="px-2 py-1">{r.name ?? "—"}</td>
                                            <td className="px-2 py-1 font-mono">{r.its ?? "—"}</td>
                                            <td className="px-2 py-1 font-mono">{r.phone}</td>
                                            <td className="px-2 py-1">{r.status}</td>
                                            <td className="px-2 py-1">{r.was_in_window ? "free" : "paid"}</td>
                                            <td className="px-2 py-1">{r.detail ?? "—"}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                    <p className="px-2 py-1 text-[11px] text-gray-400">{recipients.length} recipient{recipients.length === 1 ? "" : "s"}.</p>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {broadcasts.length === 0 && (
                <tr><td colSpan={8} className="px-2 py-3 text-center text-gray-400">No broadcasts yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {manageOpen && (
        <ManageTemplatesModal
          templates={templates}
          onClose={() => setManageOpen(false)}
          onSaved={async () => {
            await loadTemplates();
          }}
        />
      )}

      {undeliverableOpen && <UndeliverableModal onClose={() => setUndeliverableOpen(false)} />}
    </div>
  );
}

type UndeliverableNumber = {
  phone: string;
  name: string | null;
  its: string | null;
  fail_count: number;
  last_error_code: number | null;
  first_failed_at: string;
  last_failed_at: string;
  suppressed_at: string | null;
};

// Undeliverable-number management: lists numbers auto-suppressed because Meta reported them as
// not-on-WhatsApp / can't-receive (so we stop re-sending), and lets an admin un-flag one (e.g. a
// mistyped number that's since been corrected) to make it sendable again.
function UndeliverableModal({ onClose }: { onClose: () => void }) {
  const [numbers, setNumbers] = useState<UndeliverableNumber[]>([]);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState<string | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);

  // Loads the suppression list. State starts at loading=true / error=null (correct for the mount
  // fetch), so this awaits before touching state — no synchronous setState inside the effect.
  const load = useCallback(async () => {
    try {
      const res = await apiFetch("/api/admin/whatsapp/undeliverable");
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to load");
      setNumbers(((await res.json()).numbers as UndeliverableNumber[]) ?? []);
      setModalError(null);
    } catch (e) {
      setModalError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  async function unflag(phone: string) {
    setClearing(phone);
    setModalError(null);
    try {
      const res = await apiFetch(`/api/admin/whatsapp/undeliverable?phone=${encodeURIComponent(phone)}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Un-flag failed");
      setNumbers((prev) => prev.filter((n) => n.phone !== phone));
    } catch (e) {
      setModalError(e instanceof Error ? e.message : "Un-flag failed");
    } finally {
      setClearing(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-3xl overflow-auto rounded-lg bg-white p-4 shadow-xl dark:bg-gray-950" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Undeliverable numbers</h2>
          <button type="button" onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700">Close</button>
        </div>
        <p className="mt-1 text-xs text-gray-500">
          These numbers are auto-skipped on every broadcast because WhatsApp reported them as not on WhatsApp / unable to receive (after repeated failures). Un-flag a number to make it sendable again — e.g. a number that was mistyped and has since been corrected.
        </p>
        {modalError && <div className="mt-3 rounded-md bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950">{modalError}</div>}
        <div className="mt-3 overflow-auto rounded-md border border-gray-200 dark:border-gray-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500 dark:bg-gray-900">
              <tr>
                <th className="px-2 py-1.5">Name</th>
                <th className="px-2 py-1.5">ITS</th>
                <th className="px-2 py-1.5">WhatsApp</th>
                <th className="px-2 py-1.5">Failures</th>
                <th className="px-2 py-1.5">Last failed</th>
                <th className="px-2 py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {numbers.map((n) => (
                <tr key={n.phone} className="border-t border-gray-100 dark:border-gray-800">
                  <td className="px-2 py-1.5">{n.name ?? "—"}</td>
                  <td className="px-2 py-1.5 font-mono text-xs">{n.its ?? "—"}</td>
                  <td className="px-2 py-1.5 font-mono">{n.phone}</td>
                  <td className="px-2 py-1.5">{n.fail_count}</td>
                  <td className="px-2 py-1.5 text-xs text-gray-500">{new Date(n.last_failed_at).toLocaleString()}</td>
                  <td className="px-2 py-1.5">
                    <button
                      type="button"
                      onClick={() => unflag(n.phone)}
                      disabled={clearing === n.phone}
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium disabled:opacity-40 dark:border-gray-700"
                    >
                      {clearing === n.phone ? "Un-flagging…" : "Un-flag"}
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && numbers.length === 0 && (
                <tr><td colSpan={6} className="px-2 py-3 text-center text-gray-400">No undeliverable numbers.</td></tr>
              )}
              {loading && (
                <tr><td colSpan={6} className="px-2 py-3 text-center text-gray-400">Loading…</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// Cleanup popup: give each Meta template a friendly name and toggle whether it shows in the console's
// pickers. Edits are saved per row via PUT /api/admin/templates/settings; deactivated templates are
// hidden from the Template dropdowns (this modal still lists them so they can be reactivated).
function ManageTemplatesModal({
  templates,
  onClose,
  onSaved,
}: {
  templates: TemplateDescriptor[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  // Keyed by tplKey so same-named templates in different WABAs keep independent drafts.
  const [drafts, setDrafts] = useState<Record<string, { friendlyName: string; isActive: boolean }>>(() =>
    Object.fromEntries(templates.map((t) => [tplKey(t), { friendlyName: t.friendlyName ?? "", isActive: t.isActive }])),
  );
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const multiAccount = new Set(templates.map((t) => t.accountLabel)).size > 1;

  function setDraft(key: string, patch: Partial<{ friendlyName: string; isActive: boolean }>) {
    setDrafts((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  async function save(t: TemplateDescriptor) {
    const key = tplKey(t);
    const d = drafts[key];
    setSavingKey(key);
    setModalError(null);
    try {
      const res = await apiFetch("/api/admin/templates/settings", {
        method: "PUT",
        // Scope the annotation to the template's WABA so a same-named template on the other account
        // isn't overwritten. Omitted/primary WABA resolves to the primary account server-side.
        body: JSON.stringify({ template_name: t.name, waba_id: t.wabaId ?? undefined, friendly_name: d.friendlyName.trim() || null, is_active: d.isActive }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Save failed");
      await onSaved();
    } catch (e) {
      setModalError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSavingKey(null);
    }
  }

  const dirty = (t: TemplateDescriptor) =>
    drafts[tplKey(t)].friendlyName !== (t.friendlyName ?? "") || drafts[tplKey(t)].isActive !== t.isActive;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-3xl overflow-auto rounded-lg bg-white p-4 shadow-xl dark:bg-gray-950" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Manage templates</h2>
          <button type="button" onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700">Close</button>
        </div>
        <p className="mt-1 text-xs text-gray-500">
          Give templates a friendly name and deactivate the ones you don’t use — deactivated templates are hidden from the Template dropdowns on this page.
        </p>
        {modalError && <div className="mt-3 rounded-md bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950">{modalError}</div>}
        <div className="mt-3 overflow-auto rounded-md border border-gray-200 dark:border-gray-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500 dark:bg-gray-900">
              <tr>
                <th className="px-2 py-1.5">Template (Meta name)</th>
                {multiAccount && <th className="px-2 py-1.5">Number</th>}
                <th className="px-2 py-1.5">Friendly name</th>
                <th className="px-2 py-1.5">Active</th>
                <th className="px-2 py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={tplKey(t)} className="border-t border-gray-100 dark:border-gray-800">
                  <td className="px-2 py-1.5 font-mono text-xs">{t.name} <span className="text-gray-400">({t.language})</span></td>
                  {multiAccount && <td className="px-2 py-1.5 text-xs text-gray-500">{accountTag(t)}</td>}
                  <td className="px-2 py-1.5">
                    <input
                      value={drafts[tplKey(t)].friendlyName}
                      onChange={(e) => setDraft(tplKey(t), { friendlyName: e.target.value })}
                      placeholder="e.g. Daily Niyaz RSVP"
                      className={`${input} w-full`}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input type="checkbox" checked={drafts[tplKey(t)].isActive} onChange={(e) => setDraft(tplKey(t), { isActive: e.target.checked })} />
                  </td>
                  <td className="px-2 py-1.5">
                    <button
                      type="button"
                      onClick={() => save(t)}
                      disabled={!dirty(t) || savingKey === tplKey(t)}
                      className="rounded-md bg-blue-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-40"
                    >
                      {savingKey === tplKey(t) ? "Saving…" : "Save"}
                    </button>
                  </td>
                </tr>
              ))}
              {templates.length === 0 && <tr><td colSpan={multiAccount ? 5 : 4} className="px-2 py-3 text-center text-gray-400">No templates.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
