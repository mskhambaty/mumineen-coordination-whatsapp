import { getSupabaseAdmin } from "@/lib/supabase/server";

// Custom audience targeting: a react-querybuilder rule tree evaluated over the roster in TS (the
// roster is ~4k rows). No dynamic SQL — every field is whitelisted by the catalog below. Used by
// the broadcast "custom" audience; the preset audiences stay in audience.ts.

export type FieldType = "enum" | "bool" | "number" | "date" | "text";

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
};

export type FieldDef = {
  key: string;
  label: string;
  group: "Person" | "Family";
  type: FieldType;
  get: (row: RosterRow) => unknown;
  enumValues?: string[];
  dynamicEnum?: boolean;
};

export const FIELD_CATALOG: FieldDef[] = [
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
  { key: "registered", label: "Registered (form submitted)", group: "Family", type: "bool", get: (r) => r.registration_status === "submitted" || r.registration_status === "confirmed" },
  { key: "registration_status", label: "Registration status", group: "Family", type: "enum", enumValues: ["not_started", "in_progress", "submitted", "confirmed", "cancelled"], get: (r) => r.registration_status },
  { key: "acc_type", label: "Accommodation", group: "Family", type: "enum", enumValues: ["hotel", "utaro"], get: (r) => r.acc_type },
  { key: "open_to_utaro", label: "Open to utaro", group: "Family", type: "bool", get: (r) => r.open_to_utaro },
  { key: "transport_mode", label: "Transport mode", group: "Family", type: "enum", enumValues: ["rideshare", "rental", "commute_with_utaro", "other"], get: (r) => r.transport_mode },
];

const FIELD_BY_KEY = new Map(FIELD_CATALOG.map((f) => [f.key, f]));

export const OPS_BY_TYPE: Record<FieldType, string[]> = {
  enum: ["in", "notIn", "null", "notNull"],
  text: ["contains", "=", "!=", "null", "notNull"],
  bool: ["="],
  number: ["=", "!=", "<", "<=", ">", ">=", "between", "null", "notNull"],
  date: ["<", "<=", ">", ">=", "between", "null", "notNull"],
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
      });
    }
    if (!data || data.length < 1000) break;
  }
  return rows;
}

// Matched roster rows for a rule tree, deduped by phone (rep = head-of-family, else lowest ITS).
// Rows without a phone are dropped (a broadcast can only message a number).
export async function runFilter(tree: RuleGroup): Promise<RosterRow[]> {
  const roster = await loadRoster();
  const byPhone = new Map<string, RosterRow>();
  for (const r of roster) {
    if (!r.whatsapp_e164 || !evaluate(tree, r)) continue;
    const phone = normalizePhone(r.whatsapp_e164);
    const existing = byPhone.get(phone);
    if (!existing) { byPhone.set(phone, r); continue; }
    const better = (Number(r.is_head) - Number(existing.is_head)) || existing.its.localeCompare(r.its);
    if (better > 0) byPhone.set(phone, r);
  }
  return [...byPhone.values()];
}

export async function dynamicEnumValues(): Promise<Record<string, string[]>> {
  const roster = await loadRoster();
  const out: Record<string, Set<string>> = {};
  for (const f of FIELD_CATALOG.filter((f) => f.dynamicEnum)) out[f.key] = new Set();
  for (const r of roster) {
    for (const f of FIELD_CATALOG.filter((f) => f.dynamicEnum)) {
      const v = f.get(r);
      if (v != null && String(v).trim()) out[f.key].add(String(v));
    }
  }
  return Object.fromEntries(Object.entries(out).map(([k, set]) => [k, [...set].sort()]));
}
