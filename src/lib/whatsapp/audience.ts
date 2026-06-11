import { optionalEnv } from "@/lib/env";
import { runFilter, runFilterDetailed, type RuleGroup } from "@/lib/whatsapp/audience-filter";
import { MAPPABLE_FIELDS } from "@/lib/whatsapp/templates";
import { getSupabaseAdmin } from "@/lib/supabase/server";

// Audience resolution for the template-send console. Each audience key resolves to a set of
// recipients, always DEDUPED by phone number (one message max per number). A recipient is "in
// window" if the number messaged us in the last 24h — those template sends are free; the rest are
// paid. Roster-based recipients also carry `fields` (mappable roster columns) so broadcasts can
// personalize template variables per recipient. The "custom" key uses the rule-tree filter engine.

export const AUDIENCE_KEYS = [
  "selected_users",
  "chicago_committee",
  "arrived_hof",
  "registered_hof",
  "all_members",
  // Niyaz reach segments (registered ∪ unregistered RSVP), used both as sendable audiences and as
  // the header summary on the console — see segmentCounts().
  "segment_all_users",
  "segment_hof",
  "segment_hof_unresponded",
  "custom",
  "csv_upload",
] as const;

export type AudienceKey = (typeof AUDIENCE_KEYS)[number];

export function isAudienceKey(v: unknown): v is AudienceKey {
  return typeof v === "string" && (AUDIENCE_KEYS as readonly string[]).includes(v);
}

export const AUDIENCE_LABEL: Record<AudienceKey, string> = {
  selected_users: "Selected users (test)",
  chicago_committee: "Chicago committee members",
  arrived_hof: "Arrived families (one per family)",
  registered_hof: "All registered families (one per family)",
  all_members: "All family members (deduped by number)",
  segment_all_users: "All users (registered + unregistered RSVP)",
  segment_hof: "Heads of family (registered + unregistered RSVP)",
  segment_hof_unresponded: "HOF with no RSVP response yet",
  custom: "Custom filter",
  csv_upload: "Uploaded CSV",
};

export type Recipient = {
  phone: string;
  familyId: string | null;
  muminId?: string | null;
  fields?: Record<string, string | null>; // mappable roster fields for personalization
};

const WINDOW_MS = 24 * 60 * 60 * 1000;

// Columns selected for roster-based audiences so recipients can personalize variables.
const MAPPABLE_COLS = MAPPABLE_FIELDS.map((f) => f.key);

function fieldsOf(row: Record<string, unknown>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const key of MAPPABLE_COLS) {
    const v = row[key];
    out[key] = v == null ? null : String(v);
  }
  return out;
}

// Normalize a phone string to "+<digits>" so it keys/dedupes consistently with getInWindowPhones
// and the broadcast recipient rows. Exported for the CSV-upload audience parser.
export function normalizePhone(input: string): string {
  const digits = input.replace(/[^\d]/g, "");
  return digits ? `+${digits}` : input;
}

// Dedupe a candidate list by phone, keeping the first recipient (with its fields) seen.
function dedupeByPhone(candidates: Recipient[]): Recipient[] {
  const byPhone = new Map<string, Recipient>();
  for (const c of candidates) {
    if (!c.phone) continue;
    const phone = normalizePhone(c.phone);
    if (!byPhone.has(phone)) byPhone.set(phone, { ...c, phone });
  }
  return [...byPhone.values()];
}

const isEmptyField = (v: unknown) => v == null || String(v).trim() === "";

// Resolve roster identity + mappable fields for a set of phones — direct via mumineen.whatsapp_e164,
// then a mumin_phone_links fallback (e.g. a shared/registration number). Chunked so large lists
// (CSV uploads) don't blow the query/URL size limit. Returns the matched mumineen rows keyed by
// normalized phone. Reused by the CSV-upload enrichment and the per-broadcast failures list.
export async function resolveRosterByPhone(phones: string[]): Promise<Map<string, Record<string, unknown> & { id: string }>> {
  const byPhone = new Map<string, Record<string, unknown> & { id: string }>();
  const norm = [...new Set(phones.map(normalizePhone))].filter(Boolean);
  if (norm.length === 0) return byPhone;
  const supabase = getSupabaseAdmin();
  // Stored numbers are inconsistent about the leading "+", so query both forms and key matches
  // through normalizePhone on both sides.
  const variants = (ps: string[]) => [...new Set(ps.flatMap((p) => [p, p.replace(/^\+/, "")]))];
  const CHUNK = 200;

  // Direct: a roster member whose own WhatsApp number is this phone.
  for (let i = 0; i < norm.length; i += CHUNK) {
    const { data: direct } = await supabase
      .from("mumineen")
      .select(`id, whatsapp_e164, ${MAPPABLE_COLS.join(", ")}`)
      .in("whatsapp_e164", variants(norm.slice(i, i + CHUNK)))
      .eq("roster_active", true);
    for (const m of (direct ?? []) as unknown as (Record<string, unknown> & { id: string; whatsapp_e164: string })[]) {
      const p = normalizePhone(m.whatsapp_e164);
      if (!byPhone.has(p)) byPhone.set(p, m);
    }
  }

  // Fallback: phone linked to a member via mumin_phone_links.
  const remaining = norm.filter((p) => !byPhone.has(p));
  if (remaining.length > 0) {
    const phoneByMumin = new Map<string, string>();
    for (let i = 0; i < remaining.length; i += CHUNK) {
      const { data: links } = await supabase.from("mumin_phone_links").select("phone_e164, mumin_id").in("phone_e164", variants(remaining.slice(i, i + CHUNK)));
      for (const l of (links ?? []) as { phone_e164: string; mumin_id: string }[]) {
        if (!phoneByMumin.has(l.mumin_id)) phoneByMumin.set(l.mumin_id, normalizePhone(l.phone_e164));
      }
    }
    const muminIds = [...phoneByMumin.keys()];
    for (let i = 0; i < muminIds.length; i += CHUNK) {
      const { data: mems } = await supabase.from("mumineen").select(`id, ${MAPPABLE_COLS.join(", ")}`).in("id", muminIds.slice(i, i + CHUNK));
      for (const m of (mems ?? []) as unknown as (Record<string, unknown> & { id: string })[]) {
        const p = phoneByMumin.get(m.id);
        if (p && !byPhone.has(p)) byPhone.set(p, m);
      }
    }
  }

  return byPhone;
}

// Fill missing roster fields on recipients by matching their phone to the roster. Existing (e.g.
// CSV-provided) field values win; only empty/missing values are filled from the roster — so a
// name-mapped template variable resolves for any recipient on the roster even when their uploaded
// row left Name blank. Used by the whatsapp_users-based audiences (no fields yet) and csv_upload.
export async function enrichFieldsByPhone(recipients: Recipient[]): Promise<void> {
  const need = recipients.filter((r) => !r.fields || MAPPABLE_COLS.some((c) => isEmptyField(r.fields![c])));
  if (need.length === 0) return;
  const byPhone = await resolveRosterByPhone(need.map((r) => r.phone));
  if (byPhone.size === 0) return;
  for (const r of need) {
    const m = byPhone.get(normalizePhone(r.phone));
    if (!m) continue;
    const merged: Record<string, string | null> = { ...fieldsOf(m) };
    for (const [k, v] of Object.entries(r.fields ?? {})) {
      if (!isEmptyField(v)) merged[k] = v as string; // CSV/explicit value wins over roster
    }
    r.fields = merged;
    r.muminId = r.muminId ?? m.id;
  }
}

// Distinct phones that have submitted an unregistered Niyaz RSVP (one per number). These callers
// aren't on the roster, so they carry no mappable fields — segment sends should use no-variable
// templates. Each phone is treated as one head of family for the HOF segments.
export async function unregisteredRsvpRecipients(): Promise<Recipient[]> {
  const { data } = await getSupabaseAdmin().from("unregistered_rsvps").select("phone_e164");
  return dedupeByPhone(((data ?? []) as { phone_e164: string }[]).map((r) => ({ phone: r.phone_e164, familyId: null })));
}

// Family ids that have a real RSVP response on record — a niyaz_rsvp row sourced from a WhatsApp
// button/admin entry, or a family head-count. Used to carve out the "haven't heard from" segment.
export async function respondedFamilyIds(): Promise<Set<string>> {
  const supabase = getSupabaseAdmin();
  const ids = new Set<string>();
  const { data: rsvps } = await supabase
    .from("niyaz_rsvp")
    .select("family_id")
    .in("source", ["whatsapp", "admin"])
    .not("family_id", "is", null);
  for (const r of (rsvps ?? []) as { family_id: string | null }[]) if (r.family_id) ids.add(r.family_id);
  const { data: heads } = await supabase.from("niyaz_family_headcount").select("family_id").not("family_id", "is", null);
  for (const r of (heads ?? []) as { family_id: string | null }[]) if (r.family_id) ids.add(r.family_id);
  return ids;
}

// Resolve the raw (deduped) recipient list for an audience. `selectedUserIds` is used by
// "selected_users"; `rules` by "custom".
export async function resolveAudience(
  key: AudienceKey,
  selectedUserIds: string[] = [],
  rules?: RuleGroup,
): Promise<Recipient[]> {
  const supabase = getSupabaseAdmin();

  // csv_upload recipients come from an uploaded file, not the database — callers must provide them
  // as an explicit list (see parseAudienceCsv + the explicit-recipients path in createBroadcast).
  if (key === "csv_upload") {
    throw new Error("csv_upload audiences are provided as an explicit recipient list, not resolved from the database.");
  }

  // Niyaz reach segments, composed from the base roster audiences plus unregistered RSVP callers.
  if (key === "segment_all_users" || key === "segment_hof") {
    const base = await resolveAudience(key === "segment_all_users" ? "all_members" : "registered_hof", selectedUserIds, rules);
    const unregistered = await unregisteredRsvpRecipients();
    return dedupeByPhone([...base, ...unregistered]);
  }

  if (key === "segment_hof_unresponded") {
    const hof = await resolveAudience("registered_hof", selectedUserIds, rules);
    const responded = await respondedFamilyIds();
    return hof.filter((r) => r.familyId && !responded.has(r.familyId));
  }

  if (key === "custom") {
    if (!rules) return [];
    const rows = await runFilter(rules); // already deduped by phone
    return rows.map((r) => ({
      phone: normalizePhone(r.whatsapp_e164 as string),
      familyId: r.family_id,
      muminId: r.mumin_id,
      fields: fieldsOf(r as unknown as Record<string, unknown>),
    }));
  }

  if (key === "selected_users") {
    if (selectedUserIds.length === 0) return [];
    const { data } = await supabase
      .from("whatsapp_users")
      .select("phone_e164")
      .in("id", selectedUserIds)
      .eq("status", "active");
    const recipients = dedupeByPhone(((data ?? []) as { phone_e164: string }[]).map((u) => ({ phone: u.phone_e164, familyId: null })));
    await enrichFieldsByPhone(recipients);
    return recipients;
  }

  if (key === "chicago_committee") {
    const { data } = await supabase
      .from("whatsapp_users")
      .select("phone_e164")
      .in("role", ["committee", "admin"])
      .eq("status", "active");
    const recipients = dedupeByPhone(((data ?? []) as { phone_e164: string }[]).map((u) => ({ phone: u.phone_e164, familyId: null })));
    await enrichFieldsByPhone(recipients);
    return recipients;
  }

  // The remaining audiences are roster families. Pull active, registered families and one
  // reachable number each (head member's WhatsApp, else any member's), carrying that member's fields.
  if (key === "registered_hof" || key === "arrived_hof") {
    const { data: families } = await supabase
      .from("families")
      .select("id, registration_status, roster_active")
      .eq("roster_active", true)
      .eq("registration_status", "submitted");

    const familyIds = ((families ?? []) as { id: string }[]).map((f) => f.id);
    if (familyIds.length === 0) return [];

    const { data: members } = await supabase
      .from("mumineen")
      .select(`id, family_id, whatsapp_e164, is_head, arrival_at, not_attending, ${MAPPABLE_COLS.join(", ")}`)
      .in("family_id", familyIds)
      .eq("roster_active", true)
      .not("whatsapp_e164", "is", null);

    type M = Record<string, unknown> & { id: string; family_id: string; whatsapp_e164: string; is_head: boolean; arrival_at: string | null; not_attending: boolean };
    const byFamily = new Map<string, { member: M; arrived: boolean }>();
    const now = Date.now();
    for (const m of (members ?? []) as unknown as M[]) {
      if (m.not_attending) continue;
      const arrived = m.arrival_at ? new Date(m.arrival_at).getTime() <= now : false;
      const existing = byFamily.get(m.family_id);
      if (!existing || m.is_head) {
        byFamily.set(m.family_id, { member: m, arrived: arrived || (existing?.arrived ?? false) });
      } else if (arrived && !existing.arrived) {
        existing.arrived = true;
      }
    }

    const recipients: Recipient[] = [];
    for (const [familyId, info] of byFamily) {
      if (key === "arrived_hof" && !info.arrived) continue;
      recipients.push({ phone: info.member.whatsapp_e164, familyId, muminId: info.member.id, fields: fieldsOf(info.member) });
    }
    return dedupeByPhone(recipients);
  }

  // all_members: every attending roster member with a number, deduped by phone.
  const { data: members } = await supabase
    .from("mumineen")
    .select(`id, family_id, whatsapp_e164, not_attending, roster_active, ${MAPPABLE_COLS.join(", ")}`)
    .eq("roster_active", true)
    .eq("not_attending", false)
    .not("whatsapp_e164", "is", null);
  return dedupeByPhone(
    ((members ?? []) as unknown as (Record<string, unknown> & { id: string; family_id: string | null; whatsapp_e164: string })[]).map((m) => ({
      phone: m.whatsapp_e164,
      familyId: m.family_id,
      muminId: m.id,
      fields: fieldsOf(m),
    })),
  );
}

// Set of phone numbers currently inside the free 24h customer-service window.
export async function getInWindowPhones(): Promise<Set<string>> {
  const cutoff = new Date(Date.now() - WINDOW_MS).toISOString();
  const { data } = await getSupabaseAdmin()
    .from("conversation_sessions")
    .select("phone_e164, last_message_at")
    .gte("last_message_at", cutoff);
  return new Set(((data ?? []) as { phone_e164: string }[]).map((r) => normalizePhone(r.phone_e164)));
}

export function utilityMessageCostUsd(): number {
  const raw = optionalEnv("WHATSAPP_UTILITY_MSG_COST_USD");
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export type AudiencePreview = {
  total: number;
  in_window: number; // free
  out_window: number; // paid
  est_cost_usd: number;
  recipients: { phone: string; familyId: string | null; muminId?: string | null; fields?: Record<string, string | null>; inWindow: boolean }[];
  // The recipient funnel, for custom filters: how the matched people reduce to unique numbers.
  funnel?: { matched: number; with_whatsapp: number; unique: number };
};

// Resolve an audience and split it into free (in-window) vs paid, with an estimated cost. For the
// custom filter it also reports the matched->reachable->deduped funnel so the count reconciles with
// the people-counts on the analytics page.
export async function previewAudience(key: AudienceKey, selectedUserIds: string[] = [], rules?: RuleGroup): Promise<AudiencePreview> {
  let recipients: Recipient[];
  let funnel: AudiencePreview["funnel"];
  if (key === "custom" && rules) {
    const d = await runFilterDetailed(rules);
    recipients = d.recipients.map((r) => ({
      phone: normalizePhone(r.whatsapp_e164 as string),
      familyId: r.family_id,
      muminId: r.mumin_id,
      fields: fieldsOf(r as unknown as Record<string, unknown>),
    }));
    funnel = { matched: d.matched, with_whatsapp: d.withWhatsapp, unique: d.recipients.length };
  } else {
    recipients = await resolveAudience(key, selectedUserIds, rules);
  }

  return { ...(await previewExplicitRecipients(recipients)), funnel };
}

// Split an already-resolved recipient list into free (in-window) vs paid with an estimated cost.
// Used by previewAudience and by the csv_upload path, which supplies recipients parsed from a file
// rather than resolved from the database.
export async function previewExplicitRecipients(recipients: Recipient[]): Promise<AudiencePreview> {
  const inWindow = await getInWindowPhones();
  const enriched = recipients.map((r) => ({ ...r, inWindow: inWindow.has(r.phone) }));
  const free = enriched.filter((r) => r.inWindow).length;
  const paid = enriched.length - free;
  return {
    total: enriched.length,
    in_window: free,
    out_window: paid,
    est_cost_usd: Number((paid * utilityMessageCostUsd()).toFixed(2)),
    recipients: enriched,
  };
}

export const SEGMENT_KEYS = ["segment_all_users", "segment_hof", "segment_hof_unresponded"] as const;

export type SegmentCount = {
  key: (typeof SEGMENT_KEYS)[number];
  label: string;
  total: number;
  in_window: number; // messaged in last 24h — reachable for free via a session message
  out_window: number; // not messaged in 24h — needs a template (counts against the daily cap)
};

// Sizes of the three Niyaz reach segments, each split into the free 24h-window vs the rest. Powers
// the console's header so staff can see how many template sends a segment would actually require.
// Resolves each segment list and the in-window phone set once.
export async function segmentCounts(): Promise<SegmentCount[]> {
  const inWindow = await getInWindowPhones();
  const out: SegmentCount[] = [];
  for (const key of SEGMENT_KEYS) {
    const recipients = await resolveAudience(key);
    const free = recipients.filter((r) => inWindow.has(normalizePhone(r.phone))).length;
    out.push({ key, label: AUDIENCE_LABEL[key], total: recipients.length, in_window: free, out_window: recipients.length - free });
  }
  return out;
}
