import type { WaTemplate, WaTemplateComponent } from "@/lib/meta/whatsapp";

// A UI-friendly description of a template's fillable variables, derived from its raw components.
// Supports both positional ({{1}}) and named ({{person_name}}) Meta templates.
export type TemplateDescriptor = {
  name: string;
  language: string;
  category: string | null;
  bodyText: string | null;
  bodyVars: string[]; // ordered variable tokens (names for named templates, "1","2"… for positional)
  bodyVarCount: number;
  named: boolean; // whether this template uses named variables
  header: { format: string; hasVar: boolean } | null; // format: TEXT | IMAGE | VIDEO | DOCUMENT
  headerVar: string | null; // header text variable token, if any
  urlButtons: { index: number; text: string | null; hasVar: boolean }[];
  // Flow buttons (sub_type "flow") — sent with a per-recipient flow_token + flow_action_data.
  flowButtons: { index: number; text: string | null }[];
};

// Ordered, de-duped variable tokens in a template string. Positional tokens are sorted numerically;
// named tokens keep first-occurrence order.
function extractTokens(text: string | undefined | null): string[] {
  if (!text) return [];
  const seen: string[] = [];
  const re = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) if (!seen.includes(m[1])) seen.push(m[1]);
  const allNumeric = seen.every((t) => /^\d+$/.test(t));
  return allNumeric ? seen.sort((a, b) => Number(a) - Number(b)) : seen;
}

function find(components: WaTemplateComponent[] | undefined, type: string): WaTemplateComponent | undefined {
  return (components ?? []).find((c) => c.type?.toUpperCase() === type);
}

// Summarize a raw Meta template into the variables the composer must collect.
export function describeTemplate(tpl: WaTemplate): TemplateDescriptor {
  const body = find(tpl.components, "BODY");
  const header = find(tpl.components, "HEADER");
  const buttonsComp = find(tpl.components, "BUTTONS");

  const headerFormat = header ? (header.format ?? "TEXT").toUpperCase() : null;
  const bodyVars = extractTokens(body?.text);
  const headerTokens = headerFormat === "TEXT" ? extractTokens(header?.text) : [];
  const named = [...bodyVars, ...headerTokens].some((t) => !/^\d+$/.test(t));

  const urlButtons = (buttonsComp?.buttons ?? [])
    .map((b, index) => ({ b, index }))
    .filter(({ b }) => b.type?.toUpperCase() === "URL")
    .map(({ b, index }) => ({ index, text: b.text ?? null, hasVar: /\{\{\s*[a-zA-Z0-9_]+\s*\}\}/.test(b.url ?? "") }));

  const flowButtons = (buttonsComp?.buttons ?? [])
    .map((b, index) => ({ b, index }))
    .filter(({ b }) => b.type?.toUpperCase() === "FLOW")
    .map(({ b, index }) => ({ index, text: b.text ?? null }));

  return {
    name: tpl.name,
    language: tpl.language,
    category: tpl.category ?? null,
    bodyText: body?.text ?? null,
    bodyVars,
    bodyVarCount: bodyVars.length,
    named,
    header: header ? { format: headerFormat ?? "TEXT", hasVar: headerTokens.length > 0 || (headerFormat ?? "TEXT") !== "TEXT" } : null,
    headerVar: headerTokens[0] ?? null,
    urlButtons,
    flowButtons,
  };
}

export type SendComponentInputs = {
  bodyParams?: string[]; // aligned to descriptor.bodyVars order
  headerText?: string | null;
  headerMediaUrl?: string | null;
  urlButtonParam?: string | null;
  // Per-send payloads for quick-reply buttons (e.g. RSVP buttons encoding level|scope|date). The
  // index matches the button's position in the template's BUTTONS component.
  quickReplyButtons?: { index: number; payload: string }[];
  // Resolved Flow buttons (sub_type "flow"): a flow_token and the flow_action_data seeding the
  // Flow's first screen. The index matches the button's position in the BUTTONS component.
  flowButtons?: { index: number; flowToken: string; flowActionData: Record<string, unknown> }[];
};

// Build the Meta `components` array for a template send. Emits named parameters (`parameter_name`)
// when the template uses named variables, positional otherwise.
export function buildSendComponents(inputs: SendComponentInputs, desc: TemplateDescriptor): unknown[] {
  const components: unknown[] = [];

  if (desc.header) {
    if (desc.header.format === "TEXT") {
      if (inputs.headerText) {
        const param: Record<string, unknown> = { type: "text", text: inputs.headerText };
        if (desc.named && desc.headerVar) param.parameter_name = desc.headerVar;
        components.push({ type: "header", parameters: [param] });
      }
    } else if (inputs.headerMediaUrl) {
      const fmt = desc.header.format.toLowerCase(); // image | video | document
      components.push({ type: "header", parameters: [{ type: fmt, [fmt]: { link: inputs.headerMediaUrl } }] });
    }
  }

  if (desc.bodyVars.length > 0) {
    const params = desc.bodyVars.map((token, i) => {
      const param: Record<string, unknown> = { type: "text", text: inputs.bodyParams?.[i] ?? "" };
      if (desc.named) param.parameter_name = token;
      return param;
    });
    components.push({ type: "body", parameters: params });
  }

  const dynamicUrlBtn = desc.urlButtons.find((b) => b.hasVar);
  if (dynamicUrlBtn && inputs.urlButtonParam) {
    components.push({
      type: "button",
      sub_type: "url",
      index: String(dynamicUrlBtn.index),
      parameters: [{ type: "text", text: inputs.urlButtonParam }],
    });
  }

  for (const btn of inputs.quickReplyButtons ?? []) {
    components.push({
      type: "button",
      sub_type: "quick_reply",
      index: String(btn.index),
      parameters: [{ type: "payload", payload: btn.payload }],
    });
  }

  for (const btn of inputs.flowButtons ?? []) {
    components.push({
      type: "button",
      sub_type: "flow",
      index: String(btn.index),
      parameters: [{ type: "action", action: { flow_token: btn.flowToken, flow_action_data: btn.flowActionData } }],
    });
  }

  return components;
}

// Render a preview of the body with variables substituted. Back-compatible: with two args it does
// positional {{n}} substitution; pass `bodyVars` to substitute named tokens by position.
export function previewBody(bodyText: string | null, bodyParams: string[], bodyVars?: string[]): string {
  if (!bodyText) return "";
  if (bodyVars && bodyVars.length > 0) {
    return bodyText.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, tok) => {
      const i = bodyVars.indexOf(tok);
      return i >= 0 ? bodyParams[i] || `{{${tok}}}` : `{{${tok}}}`;
    });
  }
  return bodyText.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => bodyParams[Number(n) - 1] ?? `{{${n}}}`);
}

// ── Per-recipient variable bindings (broadcasts) ────────────────────────────

export type Binding = { kind: "static"; value: string } | { kind: "field"; field: string };

// Per-recipient button payload specs. Each string may contain {{token}} placeholders resolved
// against the recipient's field map plus per-send static tokens (VariableBindings.buttonTokens).
// Recognized aliases: {{Person.Id}} (recipient mumin id), {{EligibleFamilyCount}}, and any field
// name; statics like {{RegistrationInstanceId}} come from buttonTokens.
export type ButtonBinding =
  | { type: "quick_reply"; index: number; payload: string }
  | { type: "flow"; index: number; flowToken: string; flowActionData: Record<string, string> };

export type VariableBindings = {
  body?: Record<string, Binding>; // token -> binding
  header?: Binding;
  headerMediaUrl?: string;
  urlButton?: Binding;
  // Templated, per-recipient button payloads (Flow + quick-reply). Resolved per recipient in
  // resolveBindings and frozen into the recipient's send inputs.
  buttons?: ButtonBinding[];
  // Per-send static token values for button templates (e.g. RegistrationInstanceId).
  buttonTokens?: Record<string, string>;
};

// Roster fields offered for per-recipient ("Field") variable mapping.
export const MAPPABLE_FIELDS: { key: string; label: string }[] = [
  { key: "full_name", label: "Full name" },
  { key: "its", label: "ITS" },
  { key: "hof_its", label: "HOF ITS" },
  { key: "jamaat", label: "Jamaat" },
  { key: "idara", label: "Idara" },
  { key: "category", label: "Category" },
  { key: "venue", label: "Venue" },
  { key: "city", label: "City" },
  { key: "gender", label: "Gender" },
  { key: "local_mehman", label: "Local / Mehman" },
  { key: "airport", label: "Airport" },
];

function resolveBinding(b: Binding | undefined, row: Record<string, unknown>): { value: string } | { missing: string } {
  if (!b) return { value: "" };
  if (b.kind === "static") return { value: b.value ?? "" };
  const v = row[b.field];
  if (v == null || String(v).trim() === "") return { missing: b.field };
  return { value: String(v) };
}

// Build the substitution context for button templates from a recipient's field map + per-send
// statics. Adds friendly aliases for the tokens used in button specs.
function buttonContext(row: Record<string, unknown>, statics: Record<string, string>): Record<string, string> {
  const ctx: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) ctx[k] = v == null ? "" : String(v);
  if (row.mumin_id != null) ctx["Person.Id"] = String(row.mumin_id);
  if (row.eligible_family_count != null) ctx["EligibleFamilyCount"] = String(row.eligible_family_count);
  for (const [k, v] of Object.entries(statics)) ctx[k] = v;
  return ctx;
}

// Substitute {{token}} placeholders (dotted names allowed) in `tpl` against `ctx`. Returns the
// resolved string, or { missing } naming the first token that is absent/empty — so the caller can
// skip a recipient for whom a required button value can't be formed.
function resolveTokens(tpl: string, ctx: Record<string, string>): { value: string } | { missing: string } {
  let missing: string | null = null;
  const value = tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, tok: string) => {
    const v = ctx[tok];
    if (v == null || v === "") {
      if (!missing) missing = tok;
      return "";
    }
    return v;
  });
  return missing ? { missing } : { value };
}

// flow_action_data values are sent as JSON; coerce integer-looking strings to numbers (e.g.
// attending_count) while leaving uuids/text as strings.
function coerceFlowValue(v: string): string | number {
  return /^-?\d+$/.test(v) ? Number(v) : v;
}

// Resolve a button spec against one recipient's context into concrete send inputs, or a skipReason
// if a required token is unresolved for this recipient.
function resolveButtons(
  buttons: ButtonBinding[],
  ctx: Record<string, string>,
): { quickReplyButtons?: SendComponentInputs["quickReplyButtons"]; flowButtons?: SendComponentInputs["flowButtons"] } | { skipReason: string } {
  let quickReplyButtons: SendComponentInputs["quickReplyButtons"];
  let flowButtons: SendComponentInputs["flowButtons"];
  for (const b of buttons) {
    if (b.type === "quick_reply") {
      const r = resolveTokens(b.payload, ctx);
      if ("missing" in r) return { skipReason: `missing ${r.missing}` };
      (quickReplyButtons ??= []).push({ index: b.index, payload: r.value });
    } else {
      const tokenR = resolveTokens(b.flowToken, ctx);
      if ("missing" in tokenR) return { skipReason: `missing ${tokenR.missing}` };
      const data: Record<string, unknown> = {};
      for (const [key, tpl] of Object.entries(b.flowActionData)) {
        const r = resolveTokens(tpl, ctx);
        if ("missing" in r) return { skipReason: `missing ${r.missing}` };
        data[key] = coerceFlowValue(r.value);
      }
      (flowButtons ??= []).push({ index: b.index, flowToken: tokenR.value, flowActionData: data });
    }
  }
  return { quickReplyButtons, flowButtons };
}

// Resolve all of a template's variable bindings against one recipient field-map → send inputs, or a
// skipReason if a mapped field is empty for this recipient.
export function resolveBindings(
  desc: TemplateDescriptor,
  bindings: VariableBindings,
  row: Record<string, unknown>,
): { inputs: SendComponentInputs; skipReason?: string } {
  const bodyParams: string[] = [];
  for (const token of desc.bodyVars) {
    const r = resolveBinding(bindings.body?.[token], row);
    if ("missing" in r) return { inputs: {}, skipReason: `missing ${r.missing}` };
    bodyParams.push(r.value);
  }

  let headerText: string | null = null;
  if (desc.header?.format === "TEXT" && desc.headerVar) {
    const r = resolveBinding(bindings.header, row);
    if ("missing" in r) return { inputs: {}, skipReason: `missing ${r.missing}` };
    headerText = r.value;
  }

  let urlButtonParam: string | null = null;
  if (desc.urlButtons.some((b) => b.hasVar)) {
    const r = resolveBinding(bindings.urlButton, row);
    if ("missing" in r) return { inputs: {}, skipReason: `missing ${r.missing}` };
    urlButtonParam = r.value;
  }

  let quickReplyButtons: SendComponentInputs["quickReplyButtons"];
  let flowButtons: SendComponentInputs["flowButtons"];
  if (bindings.buttons && bindings.buttons.length > 0) {
    const resolved = resolveButtons(bindings.buttons, buttonContext(row, bindings.buttonTokens ?? {}));
    if ("skipReason" in resolved) return { inputs: {}, skipReason: resolved.skipReason };
    quickReplyButtons = resolved.quickReplyButtons;
    flowButtons = resolved.flowButtons;
  }

  return { inputs: { bodyParams, headerText, headerMediaUrl: bindings.headerMediaUrl ?? null, urlButtonParam, quickReplyButtons, flowButtons } };
}
