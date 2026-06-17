import { FILTERABLE_AGENT_TOOLS } from "@/lib/agent/tool-names";
import { getSupabaseAdmin } from "@/lib/supabase/server";

// Custom audience targeting: a react-querybuilder rule tree evaluated over the roster in TS (the
// roster is ~4k rows). No dynamic SQL — every field is whitelisted by the catalog below. Used by
// the broadcast "custom" audience; the preset audiences stay in audience.ts.

export type FieldType = "enum" | "bool" | "number" | "date" | "text" | "set";

// Sentinel "hours since" value for behavioral rows that never happened (never messaged, never used a
// tool). Using a large number rather than NaN/null makes both directions correct: "≤ N" excludes
// these rows, "> N" includes them (haven't done it in N hours).
const NEVER = 1e9;

export type RosterRow = {
  mumin_id: string;
  family_id: string | null;
  its: string;
  full_name: string | null;
  gender: string | null;
  age: number | null;
  is_adult: boolean | null;
  is_head: boolean | null;
  hof_its: string | null;
  jamaat: string | null;
  idara: string | null;
  category: string | null;
  venue: string | null;
  city: string | null;
  local_mehman: string | null;
  whatsapp_e164: string | null;
  whatsapp_link_clicked: boolean | null;
  arrival_at: string | null;
  departure_at: string | null;
  airport: string | null;
  rahat_seating: boolean | null;
  wheelchair: boolean | null;
  special_needs: string | null;
  wants_khidmat: boolean | null;
  khidmat_count: number;
  not_attending: boolean | null;
  registration_status: string | null;
  acc_type: string | null;
  open_to_utaro: boolean | null;
  transport_mode: string | null;
  has_child_under_7: boolean; // household-level: someone in this family is under 7 (computed in loadRoster)
  // Behavioral signals attached in loadRoster() from the per-phone aggregate views (keyed by
  // whatsapp_e164). Default to zero / empty when the number has no history.
  inbound_count: number;
  outbound_count: number;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  tool_last_used: Record<string, string>; // tool_name -> last-used ISO
  template_last_sent: Record<string, string>; // template_code -> last-sent ISO
};

export type FieldDef = {
  key: string;
  label: string;
  group: "Person" | "Family" | "Engagement" | "AI tool usage" | "Template history";
  type: FieldType;
  get: (row: RosterRow) => unknown;
  enumValues?: string[];
  dynamicEnum?: boolean;
};

export const FIELD_CATALOG: FieldDef[] = [
  { key: "full_name", label: "Full name", group: "Person", type: "text", get: (r) => r.full_name },
  { key: "its", label: "ITS", group: "Person", type: "text", get: (r) => r.its },
  { key: "hof_its", label: "HOF ITS", group: "Person", type: "text", get: (r) => r.hof_its },
  { key: "jamaat", label: "Jamaat", group: "Person", type: "enum", dynamicEnum: true, get: (r) => r.jamaat },
  { key: "city", label: "City", group: "Person", type: "enum", dynamicEnum: true, get: (r) => r.city },
  { key: "category", label: "Category", group: "Person", type: "enum", dynamicEnum: true, get: (r) => r.category },
  { key: "venue", label: "Venue", group: "Person", type: "enum", dynamicEnum: true, get: (r) => r.venue },
  { key: "gender", label: "Gender", group: "Person", type: "enum", enumValues: ["M", "F"], get: (r) => r.gender },
  { key: "age", label: "Age", group: "Person", type: "number", get: (r) => r.age },
  { key: "is_adult", label: "Is adult", group: "Person", type: "bool", get: (r) => r.is_adult },
  { key: "is_head", label: "Is head of family", group: "Person", type: "bool", get: (r) => r.is_head },
  { key: "local_mehman", label: "Local / Mehman", group: "Person", type: "enum", enumValues: ["Local", "Mehman"], get: (r) => r.local_mehman },
  { key: "has_whatsapp", label: "Has WhatsApp number", group: "Person", type: "bool", get: (r) => Boolean(r.whatsapp_e164) },
  { key: "whatsapp_link_clicked", label: "WhatsApp link clicked", group: "Person", type: "bool", get: (r) => r.whatsapp_link_clicked },
  { key: "arrival_at", label: "Arrival date", group: "Person", type: "date", get: (r) => r.arrival_at },
  { key: "departure_at", label: "Departure date", group: "Person", type: "date", get: (r) => r.departure_at },
  { key: "airport", label: "Airport", group: "Person", type: "enum", enumValues: ["ORD", "MDW"], get: (r) => r.airport },
  { key: "rahat_seating", label: "Rahat seating", group: "Person", type: "bool", get: (r) => r.rahat_seating },
  { key: "wheelchair", label: "Wheelchair", group: "Person", type: "bool", get: (r) => r.wheelchair },
  { key: "special_needs", label: "Special needs", group: "Person", type: "text", get: (r) => r.special_needs },
  { key: "wants_khidmat", label: "Wants khidmat", group: "Person", type: "bool", get: (r) => r.wants_khidmat },
  { key: "khidmat_signed_up", label: "Khidmat dept selected", group: "Person", type: "bool", get: (r) => r.khidmat_count > 0 },
  { key: "not_attending", label: "Not attending", group: "Person", type: "bool", get: (r) => r.not_attending },
  { key: "registered", label: "Registered (form submitted)", group: "Family", type: "bool", get: (r) => r.registration_status === "submitted" },
  { key: "registration_status", label: "Registration status", group: "Family", type: "enum", enumValues: ["not_started", "submitted"], get: (r) => r.registration_status },
  { key: "acc_type", label: "Accommodation", group: "Family", type: "enum", enumValues: ["hotel", "utaro"], get: (r) => r.acc_type },
  { key: "open_to_utaro", label: "Open to utaro", group: "Family", type: "bool", get: (r) => r.open_to_utaro },
  { key: "transport_mode", label: "Transport mode", group: "Family", type: "enum", enumValues: ["rideshare", "rental", "commute_with_utaro", "other"], get: (r) => r.transport_mode },
  { key: "has_child_under_7", label: "Household has a child under 7", group: "Family", type: "bool", get: (r) => r.has_child_under_7 },

  // Engagement — conversation/messaging behavior, from phone_message_stats (see loadRoster).
  { key: "hours_since_last_inbound", label: "Hours since they last messaged us", group: "Engagement", type: "number", get: (r) => (r.last_inbound_at ? (Date.now() - new Date(r.last_inbound_at).getTime()) / 3.6e6 : NEVER) },
  { key: "has_messaged_us", label: "Has ever messaged us", group: "Engagement", type: "bool", get: (r) => r.inbound_count > 0 },
  { key: "no_reply_from_them", label: "We messaged, no reply", group: "Engagement", type: "bool", get: (r) => r.last_outbound_at != null && r.inbound_count === 0 },
  { key: "inbound_message_count", label: "Inbound message count", group: "Engagement", type: "number", get: (r) => r.inbound_count },

  // AI tool usage — a recency-windowed set: "used / didn't use any of [tools] in the last N hours".
  // Values are the curated mumineen-facing tools; get() returns tool_name -> last-used ISO.
  { key: "tools_used", label: "AI tools used", group: "AI tool usage", type: "set", enumValues: FILTERABLE_AGENT_TOOLS.map((t) => t.name), get: (r) => r.tool_last_used },

  // Template history — recency-windowed set: "sent / not sent any of [templates] in the last N hours".
  { key: "templates_sent", label: "Templates sent", group: "Template history", type: "set", dynamicEnum: true, get: (r) => r.template_last_sent },
];

const FIELD_BY_KEY = new Map(FIELD_CATALOG.map((f) => [f.key, f]));

export const OPS_BY_TYPE: Record<FieldType, string[]> = {
  enum: ["in", "notIn", "null", "notNull"],
  text: ["contains", "=", "!=", "null", "notNull"],
  bool: ["="],
  number: ["=", "!=", "<", "<=", ">", ">=", "between", "null", "notNull"],
  date: ["<", "<=", ">", ">=", "between", "null", "notNull"],
  // set: "in" = did any of the selected within the window; "notIn" = did none of them within the
  // window (covers never-done AND done-before-the-window). Value is { items, withinHours }.
  set: ["in", "notIn"],
};

export type Rule = { field: string; operator: string; value?: unknown };
export type RuleGroup = { combinator: "and" | "or"; rules: Array<Rule | RuleGroup> };

function isGroup(node: Rule | RuleGroup): node is RuleGroup {
  return (node as RuleGroup).combinator !== undefined && Array.isArray((node as RuleGroup).rules);
}

export function validateRules(node: Rule | RuleGroup, depth = 0): string | null {
  if (isGroup(node)) {
    if (depth > 2) return "Filters can nest at most 2 levels deep.";
    if (node.combinator !== "and" && node.combinator !== "or") return "Invalid combinator.";
    for (const child of node.rules) {
      const err = validateRules(child, depth + 1);
      if (err) return err;
    }
    return null;
  }
  const def = FIELD_BY_KEY.get(node.field);
  if (!def) return `Unknown field: ${node.field}`;
  if (!OPS_BY_TYPE[def.type].includes(node.operator)) return `Operator ${node.operator} not allowed for ${node.field}.`;
  if (def.type === "set") {
    const v = node.value as { items?: unknown; withinHours?: unknown } | undefined;
    if (!v || !Array.isArray(v.items) || v.items.length === 0) return `Select at least one option for ${node.field}.`;
    if (v.withinHours != null && !(typeof v.withinHours === "number" && v.withinHours > 0)) return `Invalid time window for ${node.field}.`;
  }
  return null;
}

function toList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (typeof value === "string") return value.split(",").map((s) => s.trim()).filter(Boolean);
  if (value == null) return [];
  return [String(value)];
}

function asDate(v: unknown): number | null {
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

function evalRule(rule: Rule, row: RosterRow): boolean {
  const def = FIELD_BY_KEY.get(rule.field);
  if (!def) return false;

  // set: membership of selected items in the row's per-item timestamp map, optionally bounded to a
  // recency window. Value is { items: string[]; withinHours: number | null } (null = ever).
  if (def.type === "set") {
    const map = (def.get(row) as Record<string, string> | null) ?? {};
    const val = (rule.value ?? {}) as { items?: unknown; withinHours?: unknown };
    const items = Array.isArray(val.items) ? val.items.map((v) => String(v)) : [];
    const withinHours = typeof val.withinHours === "number" && val.withinHours > 0 ? val.withinHours : null;
    const now = Date.now();
    const didWithin = items.some((i) => {
      const at = map[i];
      if (!at) return false;
      if (withinHours == null) return true;
      return (now - new Date(at).getTime()) / 3.6e6 <= withinHours;
    });
    if (rule.operator === "in") return didWithin;
    if (rule.operator === "notIn") return !didWithin;
    return false;
  }

  const raw = def.get(row);
  const op = rule.operator;

  if (op === "null") return raw === null || raw === undefined || raw === "";
  if (op === "notNull") return !(raw === null || raw === undefined || raw === "");
  if (def.type === "bool") return Boolean(raw) === (rule.value === true || String(rule.value) === "true");

  if (def.type === "number") {
    const n = typeof raw === "number" ? raw : Number(raw);
    if (Number.isNaN(n)) return false;
    if (op === "between") {
      const [a, b] = toList(rule.value).map(Number);
      return n >= a && n <= b;
    }
    const t = Number(rule.value);
    switch (op) {
      case "=": return n === t;
      case "!=": return n !== t;
      case "<": return n < t;
      case "<=": return n <= t;
      case ">": return n > t;
      case ">=": return n >= t;
    }
    return false;
  }

  if (def.type === "date") {
    const n = asDate(raw);
    if (n === null) return false;
    if (op === "between") {
      const [a, b] = toList(rule.value).map(asDate);
      return a !== null && b !== null && n >= a && n <= b;
    }
    const t = asDate(rule.value);
    if (t === null) return false;
    switch (op) {
      case "<": return n < t;
      case "<=": return n <= t;
      case ">": return n > t;
      case ">=": return n >= t;
    }
    return false;
  }

  const s = raw == null ? "" : String(raw);
  switch (op) {
    case "=": return s === String(rule.value ?? "");
    case "!=": return s !== String(rule.value ?? "");
    case "contains": return s.toLowerCase().includes(String(rule.value ?? "").toLowerCase());
    case "in": return toList(rule.value).includes(s);
    case "notIn": return !toList(rule.value).includes(s);
  }
  return false;
}

export function evaluate(node: Rule | RuleGroup, row: RosterRow): boolean {
  if (isGroup(node)) {
    if (node.rules.length === 0) return true;
    return node.combinator === "and" ? node.rules.every((c) => evaluate(c, row)) : node.rules.some((c) => evaluate(c, row));
  }
  return evalRule(node, row);
}

function normalizePhone(input: string): string {
  const digits = input.replace(/[^\d]/g, "");
  return digits ? `+${digits}` : input;
}

// Page through an aggregate view (one row per phone, or per phone+key) in 1000-row windows — the
// PostgREST cap. Ordered by phone_e164 for stable, non-overlapping paging.
async function fetchAllView<T>(table: string, columns: string): Promise<T[]> {
  const supabase = getSupabaseAdmin();
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(columns).order("phone_e164", { ascending: true }).range(from, from + 999);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as T[];
    out.push(...batch);
    if (batch.length < 1000) break;
  }
  return out;
}

async function loadRoster(): Promise<RosterRow[]> {
  const supabase = getSupabaseAdmin();

  const families = new Map<string, { id: string; registration_status: string | null; acc_type: string | null; open_to_utaro: boolean | null; transport_mode: string | null }>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("families")
      .select("id, hof_its, registration_status, acc_type, open_to_utaro, transport_mode")
      .eq("roster_active", true)
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const f of data ?? []) if (f.hof_its) families.set(f.hof_its, f);
    if (!data || data.length < 1000) break;
  }

  // Behavioral aggregates, keyed by normalized phone (matches whatsapp_e164). Built from the three
  // per-phone views so the Engagement / AI tool usage / Template history fields resolve in-app.
  const msgByPhone = new Map<string, { inbound_count: number; outbound_count: number; last_inbound_at: string | null; last_outbound_at: string | null }>();
  for (const r of await fetchAllView<{ phone_e164: string; inbound_count: number; outbound_count: number; last_inbound_at: string | null; last_outbound_at: string | null }>("phone_message_stats", "phone_e164, inbound_count, outbound_count, last_inbound_at, last_outbound_at")) {
    if (r.phone_e164) msgByPhone.set(normalizePhone(r.phone_e164), { inbound_count: Number(r.inbound_count) || 0, outbound_count: Number(r.outbound_count) || 0, last_inbound_at: r.last_inbound_at, last_outbound_at: r.last_outbound_at });
  }

  const filterableTools = new Set(FILTERABLE_AGENT_TOOLS.map((t) => t.name));
  const toolByPhone = new Map<string, Record<string, string>>();
  for (const r of await fetchAllView<{ phone_e164: string; tool_name: string; last_used_at: string }>("phone_tool_usage", "phone_e164, tool_name, last_used_at")) {
    if (!r.phone_e164 || !filterableTools.has(r.tool_name)) continue;
    const p = normalizePhone(r.phone_e164);
    const m = toolByPhone.get(p) ?? {};
    m[r.tool_name] = r.last_used_at;
    toolByPhone.set(p, m);
  }

  const tplByPhone = new Map<string, Record<string, string>>();
  for (const r of await fetchAllView<{ phone_e164: string; template_code: string | null; last_sent_at: string }>("phone_template_sends", "phone_e164, template_code, last_sent_at")) {
    if (!r.phone_e164 || !r.template_code) continue;
    const p = normalizePhone(r.phone_e164);
    const m = tplByPhone.get(p) ?? {};
    m[r.template_code] = r.last_sent_at;
    tplByPhone.set(p, m);
  }

  // Households with at least one child under 7, by hof_its. Lets a "household has a young child"
  // flag target the PARENT (deduped to head of family), not the toddler. Computed live so it never
  // goes stale as the roster changes.
  const youngChildHofs = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("mumineen")
      .select("hof_its")
      .eq("roster_active", true)
      .lt("age", 7)
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) if (r.hof_its) youngChildHofs.add(r.hof_its);
    if (!data || data.length < 1000) break;
  }

  const rows: RosterRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("mumineen")
      .select(
        "id, full_name, gender, age, is_adult, is_head, its, hof_its, jamaat, idara, category, venue, city, local_mehman, whatsapp_e164, whatsapp_link_clicked, arrival_at, departure_at, airport, rahat_seating, wheelchair, special_needs, wants_khidmat, khidmat_department_ids, not_attending",
      )
      .eq("roster_active", true)
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const m of data ?? []) {
      const fam = m.hof_its ? families.get(m.hof_its) : undefined;
      const khidmat = Array.isArray((m as { khidmat_department_ids?: unknown }).khidmat_department_ids)
        ? ((m as { khidmat_department_ids: unknown[] }).khidmat_department_ids).length
        : 0;
      const phone = m.whatsapp_e164 ? normalizePhone(m.whatsapp_e164) : null;
      const msg = phone ? msgByPhone.get(phone) : undefined;
      rows.push({
        mumin_id: m.id,
        family_id: fam?.id ?? null,
        its: m.its,
        full_name: m.full_name,
        gender: m.gender,
        age: m.age,
        is_adult: m.is_adult,
        is_head: m.is_head,
        hof_its: m.hof_its,
        jamaat: m.jamaat,
        idara: m.idara,
        category: m.category,
        venue: m.venue,
        city: m.city,
        local_mehman: m.local_mehman,
        whatsapp_e164: m.whatsapp_e164,
        whatsapp_link_clicked: m.whatsapp_link_clicked,
        arrival_at: m.arrival_at,
        departure_at: m.departure_at,
        airport: m.airport,
        rahat_seating: m.rahat_seating,
        wheelchair: m.wheelchair,
        special_needs: m.special_needs,
        wants_khidmat: m.wants_khidmat,
        khidmat_count: khidmat,
        not_attending: m.not_attending,
        registration_status: fam?.registration_status ?? null,
        acc_type: fam?.acc_type ?? null,
        open_to_utaro: fam?.open_to_utaro ?? null,
        transport_mode: fam?.transport_mode ?? null,
        has_child_under_7: m.hof_its ? youngChildHofs.has(m.hof_its) : false,
        inbound_count: msg?.inbound_count ?? 0,
        outbound_count: msg?.outbound_count ?? 0,
        last_inbound_at: msg?.last_inbound_at ?? null,
        last_outbound_at: msg?.last_outbound_at ?? null,
        tool_last_used: (phone ? toolByPhone.get(phone) : undefined) ?? {},
        template_last_sent: (phone ? tplByPhone.get(phone) : undefined) ?? {},
      });
    }
    if (!data || data.length < 1000) break;
  }
  return rows;
}

export type FilterFunnel = {
  matched: number; // roster rows passing the rules (incl. those with no phone)
  withWhatsapp: number; // of matched, those with a WhatsApp number
  recipients: RosterRow[]; // deduped-by-phone reachable rows (rep = head-of-family, else lowest ITS)
};

// Evaluate a rule tree over the roster and report the recipient funnel: matched people, those with
// a number, and the deduped reachable rows. A broadcast can only message a number, so rows without
// one are counted (withWhatsapp/matched) but excluded from recipients.
export async function runFilterDetailed(tree: RuleGroup): Promise<FilterFunnel> {
  const roster = await loadRoster();
  let matched = 0;
  let withWhatsapp = 0;
  const byPhone = new Map<string, RosterRow>();
  for (const r of roster) {
    if (!evaluate(tree, r)) continue;
    matched += 1;
    if (!r.whatsapp_e164) continue;
    withWhatsapp += 1;
    const phone = normalizePhone(r.whatsapp_e164);
    const existing = byPhone.get(phone);
    if (!existing) { byPhone.set(phone, r); continue; }
    const better = (Number(r.is_head) - Number(existing.is_head)) || existing.its.localeCompare(r.its);
    if (better > 0) byPhone.set(phone, r);
  }
  return { matched, withWhatsapp, recipients: [...byPhone.values()] };
}

// Matched roster rows for a rule tree, deduped by phone. (Recipients only — see runFilterDetailed
// for the funnel counts.)
export async function runFilter(tree: RuleGroup): Promise<RosterRow[]> {
  return (await runFilterDetailed(tree)).recipients;
}

export async function dynamicEnumValues(): Promise<Record<string, string[]>> {
  const roster = await loadRoster();
  const out: Record<string, Set<string>> = {};
  for (const f of FIELD_CATALOG.filter((f) => f.dynamicEnum)) out[f.key] = new Set();
  for (const r of roster) {
    for (const f of FIELD_CATALOG.filter((f) => f.dynamicEnum)) {
      const v = f.get(r);
      if (f.type === "set") {
        // set fields' get() returns a Record<item, ISO>; the dropdown options are its keys.
        if (v && typeof v === "object") for (const k of Object.keys(v as Record<string, unknown>)) out[f.key].add(k);
      } else if (v != null && String(v).trim()) {
        out[f.key].add(String(v));
      }
    }
  }
  return Object.fromEntries(Object.entries(out).map(([k, set]) => [k, [...set].sort()]));
}
