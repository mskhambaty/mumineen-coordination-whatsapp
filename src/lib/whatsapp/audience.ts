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

// Restricts a resolved audience to one side of the 24h customer-service window: "in_window" (free —
// they messaged us in the last 24h) or "out_window" (paid — needs a template). "all" keeps both.
export const WINDOW_FILTERS = ["all", "in_window", "out_window"] as const;
export type WindowFilter = (typeof WINDOW_FILTERS)[number];

export function isWindowFilter(v: unknown): v is WindowFilter {
  return typeof v === "string" && (WINDOW_FILTERS as readonly string[]).includes(v);
}

export const AUDIENCE_LABEL: Record<AudienceKey, string> = {
  selected_users: "Selected users (test)",
  chicago_committee: "Chicago committee members",
  arrived_hof: "Arrived families (one per family)",
  registered_hof: "All registered families (one per family)",
  all_members: "All family members (deduped by number)",
  segment_all_users: "All users (registered + unregistered RSVP)",
  segment_hof: "Heads of family (registered + unregistered RSVP)",
  segment_hof_unresponded: "HOF — no RSVP response & no prior template",
  custom: "Custom filter",
  csv_upload: "Uploaded CSV",
};

export type Recipient = {
  phone: string;
  familyId: string | null;
  muminId?: string | null;
  fields?: Record<string, string | null>; // mappable roster fields for personalization
};

const DEFAULT_WINDOW_HOURS = 24;

// Hours of the WhatsApp customer-service window we treat as "free" (in-window). Meta's billing
// window is 24h; set WHATSAPP_WINDOW_HOURS *below* 24 for a conservative safety margin — e.g. 14
// means anyone who hasn't messaged us in 14h is counted as paid even though they may technically
// still be free, avoiding edge cases where the window closes between preview and send. This is the
// default; the Send Templates console can override it per-action (see the `hours` params below).
// Defaults to 24. Non-positive / unparseable values fall back to the default.
export function windowHours(): number {
  const raw = optionalEnv("WHATSAPP_WINDOW_HOURS");
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_WINDOW_HOURS;
}

// Clamp a UI-supplied window override to a sane range (Meta's billing window is 24h, so a value
// above that would wrongly count paid recipients as free). Falls back to the env default when the
// value is missing or unusable.
export function resolveWindowHours(hours?: number | null): number {
  if (typeof hours === "number" && Number.isFinite(hours) && hours > 0) return Math.min(hours, 24);
  return windowHours();
}

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

// PostgREST caps a single response at 1000 rows, which silently truncated the roster scans and made
// audience counts collapse (e.g. 3k+ members read as ~900). Page through a query in 1000-row windows
// so the full set is returned. `make` must return a fresh query builder each call (so .range() can be
// applied) and the query must carry a stable .order() for correct, non-overlapping paging.
interface Pageable<T> {
  range(from: number, to: number): PromiseLike<{ data: T[] | null }>;
}
async function fetchAllRows<T>(make: () => Pageable<T>): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data } = await make().range(from, from + PAGE - 1);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

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
// Paginated: there are thousands of niyaz_rsvp response rows, well past the 1000-row cap.
export async function respondedFamilyIds(): Promise<Set<string>> {
  const supabase = getSupabaseAdmin();
  const ids = new Set<string>();
  const rsvps = await fetchAllRows<{ family_id: string | null }>(() =>
    supabase.from("niyaz_rsvp").select("family_id").in("source", ["whatsapp", "admin"]).not("family_id", "is", null).order("family_id", { ascending: true }) as unknown as Pageable<{ family_id: string | null }>,
  );
  for (const r of rsvps) if (r.family_id) ids.add(r.family_id);
  const heads = await fetchAllRows<{ family_id: string | null }>(() =>
    supabase.from("niyaz_family_headcount").select("family_id").not("family_id", "is", null).order("family_id", { ascending: true }) as unknown as Pageable<{ family_id: string | null }>,
  );
  for (const r of heads) if (r.family_id) ids.add(r.family_id);
  return ids;
}

// Phones we've already sent an approved template to (any purpose — registration reminders, daily
// Niyaz RSVP, notifications). Every template send routes through sendTemplateNotification →
// recordOutboundMessage, which logs an outbound `messages` row whose body is prefixed `[template:…]`
// (message_type stays 'text'), so that prefix is the canonical "we templated this number" marker.
// Paginated — thousands of rows. Used to keep the "fresh contacts" segment to people we haven't
// burned a template on yet.
export async function templatedPhones(): Promise<Set<string>> {
  const supabase = getSupabaseAdmin();
  const rows = await fetchAllRows<{ phone_e164: string }>(() =>
    supabase.from("messages").select("phone_e164").eq("direction", "outbound").like("body", "[template:%").order("id", { ascending: true }) as unknown as Pageable<{ phone_e164: string }>,
  );
  return new Set(rows.map((r) => normalizePhone(r.phone_e164)));
}

// One attending roster member row, with the columns the audiences personalize on.
type RosterMember = Record<string, unknown> & {
  id: string;
  family_id: string | null;
  whatsapp_e164: string;
  is_head: boolean | null;
  arrival_at: string | null;
  not_attending: boolean;
};

// Every attending, roster-active member that has a WhatsApp number — paginated so the full roster
// (3k+ rows) is read, not just the first 1000. Shared by all_members and the per-family audiences.
async function fetchAttendingRosterMembers(): Promise<RosterMember[]> {
  const supabase = getSupabaseAdmin();
  return fetchAllRows<RosterMember>(() =>
    supabase
      .from("mumineen")
      .select(`id, family_id, whatsapp_e164, is_head, arrival_at, not_attending, ${MAPPABLE_COLS.join(", ")}`)
      .eq("roster_active", true)
      .eq("not_attending", false)
      .not("whatsapp_e164", "is", null)
      .order("id", { ascending: true }) as unknown as Pageable<RosterMember>,
  );
}

// Collapse a member list to one reachable number per family, preferring the head-of-family member,
// else any member (so a family whose head lacks a number is still reached). Members with no family
// are each kept individually. `onlyFamilyIds` restricts to a family set; `onlyArrived` keeps only
// families with at least one arrived member.
function oneReachablePerFamily(members: RosterMember[], opts: { onlyFamilyIds?: Set<string>; onlyArrived?: boolean } = {}): Recipient[] {
  const byFamily = new Map<string, { member: RosterMember; arrived: boolean }>();
  const individuals: Recipient[] = [];
  const now = Date.now();
  for (const m of members) {
    if (!m.family_id) {
      if (!opts.onlyFamilyIds) individuals.push({ phone: normalizePhone(m.whatsapp_e164), familyId: null, muminId: m.id, fields: fieldsOf(m) });
      continue;
    }
    if (opts.onlyFamilyIds && !opts.onlyFamilyIds.has(m.family_id)) continue;
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
    if (opts.onlyArrived && !info.arrived) continue;
    recipients.push({ phone: normalizePhone(info.member.whatsapp_e164), familyId, muminId: info.member.id, fields: fieldsOf(info.member) });
  }
  return dedupeByPhone([...recipients, ...individuals]);
}

// Family ids that completed in-app registration (registration_status='submitted'). Registration is
// our signal of intended attendance (arrival date, hotel, etc.), so the reach segments are scoped to
// these families — not the whole imported roster. Paginated for safety.
export async function submittedFamilyIds(): Promise<Set<string>> {
  const supabase = getSupabaseAdmin();
  const rows = await fetchAllRows<{ id: string }>(() =>
    supabase.from("families").select("id").eq("roster_active", true).eq("registration_status", "submitted").order("id", { ascending: true }) as unknown as Pageable<{ id: string }>,
  );
  return new Set(rows.map((f) => f.id));
}

// Every attending member of a registered (submitted) family, deduped by phone — the "registered
// users" side of the All-users segment.
export async function registeredMemberRecipients(): Promise<Recipient[]> {
  const submitted = await submittedFamilyIds();
  if (submitted.size === 0) return [];
  const members = await fetchAttendingRosterMembers();
  return dedupeByPhone(
    members
      .filter((m) => m.family_id && submitted.has(m.family_id))
      .map((m) => ({ phone: normalizePhone(m.whatsapp_e164), familyId: m.family_id, muminId: m.id, fields: fieldsOf(m) })),
  );
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

  // Niyaz reach segments — scoped to people we expect to attend: members of registered (submitted)
  // families plus unregistered callers who told us they're coming for Niyaz. "All users" = every
  // registered member; HOF = one head per registered family. Both union the unregistered RSVP
  // callers; the unresponded segment then drops families we've already heard from.
  if (key === "segment_all_users" || key === "segment_hof") {
    const base = key === "segment_all_users" ? await registeredMemberRecipients() : await resolveAudience("registered_hof");
    const unregistered = await unregisteredRsvpRecipients();
    return dedupeByPhone([...base, ...unregistered]);
  }

  if (key === "segment_hof_unresponded") {
    const hof = await resolveAudience("registered_hof");
    const [responded, templated] = await Promise.all([respondedFamilyIds(), templatedPhones()]);
    return hof.filter((r) => r.familyId && !responded.has(r.familyId) && !templated.has(normalizePhone(r.phone)));
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

  // registered_hof / arrived_hof: app-registered (submitted) roster families, one reachable number
  // each (head's WhatsApp, else any member's). The submitted-family set is held in memory and the
  // member scan is paginated + filtered in-app — avoids both the 1000-row cap and a giant
  // family_id IN (...) URL that silently returned nothing at scale.
  if (key === "registered_hof" || key === "arrived_hof") {
    const submittedIds = await submittedFamilyIds();
    if (submittedIds.size === 0) return [];
    const members = await fetchAttendingRosterMembers();
    return oneReachablePerFamily(members, { onlyFamilyIds: submittedIds, onlyArrived: key === "arrived_hof" });
  }

  // all_members: every attending roster member with a number, deduped by phone.
  const members = await fetchAttendingRosterMembers();
  return dedupeByPhone(
    members.map((m) => ({ phone: normalizePhone(m.whatsapp_e164), familyId: m.family_id, muminId: m.id, fields: fieldsOf(m) })),
  );
}

// Set of phone numbers currently inside the free customer-service window. `hours` overrides the
// window size (defaults to the env-configured value). Paginated so the count stays correct as
// in-window traffic grows past 1000 during Ashara.
export async function getInWindowPhones(hours?: number): Promise<Set<string>> {
  const cutoff = new Date(Date.now() - resolveWindowHours(hours) * 60 * 60 * 1000).toISOString();
  const rows = await fetchAllRows<{ phone_e164: string }>(() =>
    getSupabaseAdmin().from("conversation_sessions").select("phone_e164").gte("last_message_at", cutoff).order("phone_e164", { ascending: true }) as unknown as Pageable<{ phone_e164: string }>,
  );
  return new Set(rows.map((r) => normalizePhone(r.phone_e164)));
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
export async function previewAudience(
  key: AudienceKey,
  selectedUserIds: string[] = [],
  rules?: RuleGroup,
  windowFilter: WindowFilter = "all",
  hours?: number,
): Promise<AudiencePreview> {
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
    // funnel describes the custom-filter resolution (matched -> reachable -> unique numbers) before
    // any window filter is applied, so it still reconciles with the analytics people-counts.
    funnel = { matched: d.matched, with_whatsapp: d.withWhatsapp, unique: d.recipients.length };
  } else {
    recipients = await resolveAudience(key, selectedUserIds, rules);
  }

  return { ...(await previewExplicitRecipients(recipients, windowFilter, hours)), funnel };
}

// Split an already-resolved recipient list into free (in-window) vs paid with an estimated cost.
// Used by previewAudience and by the csv_upload path, which supplies recipients parsed from a file
// rather than resolved from the database.
export async function previewExplicitRecipients(
  recipients: Recipient[],
  windowFilter: WindowFilter = "all",
  hours?: number,
): Promise<AudiencePreview> {
  const inWindow = await getInWindowPhones(hours);
  const tagged = recipients.map((r) => ({ ...r, inWindow: inWindow.has(r.phone) }));
  // Optionally keep only one side of the 24h window, then report counts on what remains — so the
  // total and cost reflect exactly the people who will be messaged.
  const enriched =
    windowFilter === "in_window" ? tagged.filter((r) => r.inWindow)
    : windowFilter === "out_window" ? tagged.filter((r) => !r.inWindow)
    : tagged;
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
export async function segmentCounts(hours?: number): Promise<SegmentCount[]> {
  const inWindow = await getInWindowPhones(hours);
  const out: SegmentCount[] = [];
  for (const key of SEGMENT_KEYS) {
    const recipients = await resolveAudience(key);
    const free = recipients.filter((r) => inWindow.has(normalizePhone(r.phone))).length;
    out.push({ key, label: AUDIENCE_LABEL[key], total: recipients.length, in_window: free, out_window: recipients.length - free });
  }
  return out;
}
