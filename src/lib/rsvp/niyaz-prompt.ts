import { getEvents, type NiyazLevel } from "@/lib/rsvp/meal-rsvp";
import { shortFamilyName } from "@/lib/rsvp/niyaz-format";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { parseAudienceCsv, type AudienceCsvResult } from "@/lib/whatsapp/audience-csv";
import { fetchAllRows, type Pageable, type Recipient } from "@/lib/whatsapp/audience";
import { MAPPABLE_FIELDS } from "@/lib/whatsapp/templates";

// Audience resolution + send context for the admin-triggered daily Niyaz RSVP templates. The button
// payloads encode `niyaz|<level>|<scope>|<date>` so a tap is self-describing on the inbound side.

const MAPPABLE_COLS = MAPPABLE_FIELDS.map((f) => f.key);

// Roster columns selected for niyaz recipients: identity (id/family_id/phone), the flags the
// audiences filter on, plus the mappable personalization fields. Shared by the audience resolver and
// the CSV-upload phone lookup so both produce identically-shaped recipients.
const NIYAZ_SEL = `id, family_id, whatsapp_e164, is_head, is_adult, not_attending, ${MAPPABLE_COLS.join(", ")}`;

function normalizePhone(input: string): string {
  const digits = input.replace(/[^\d]/g, "");
  return digits ? `+${digits}` : input;
}

function fieldsOf(row: Record<string, unknown>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const key of MAPPABLE_COLS) {
    const v = row[key];
    out[key] = v == null ? null : String(v);
  }
  return out;
}

function dedupeByPhone(list: Recipient[]): Recipient[] {
  const byPhone = new Map<string, Recipient>();
  for (const r of list) {
    if (!r.phone) continue;
    if (!byPhone.has(r.phone)) byPhone.set(r.phone, r);
  }
  return [...byPhone.values()];
}

// Who counts toward eligible_family_count (the {{EligibleFamilyCount}} flow prefill): roster-active,
// not marked not-attending, and older than 5 (young children are excluded). Unknown age (null) is
// treated as eligible, matching the "null age = adult" convention used elsewhere.
function isEligibleForCount(m: { not_attending: boolean | null; age: number | null }): boolean {
  return m.not_attending !== true && (m.age == null || m.age > 5);
}

export type NiyazAudienceKind = "specific_its" | "all_mumineen" | "all_hof" | "all_adults" | "all_adults_hof";

// The per-recipient template field map for ONE family (its head) — used to resolve the confirmation
// template's variable/button bindings in phase 2. Mirrors the recipient fields built by
// resolveNiyazAudience: roster MAPPABLE columns + mumin_id, mumin_name, family_members,
// eligible_family_count.
export async function getFamilyTemplateFields(familyId: string): Promise<Record<string, string | null>> {
  const supabase = getSupabaseAdmin();
  const head = await supabase
    .from("mumineen")
    .select(`id, full_name, ${MAPPABLE_COLS.join(", ")}`)
    .eq("family_id", familyId)
    .eq("roster_active", true)
    .order("is_head", { ascending: false })
    .limit(1)
    .maybeSingle();
  const headRow = (head.data ?? null) as (Record<string, unknown> & { id?: string; full_name?: string | null }) | null;

  const fields: Record<string, string | null> = headRow ? fieldsOf(headRow) : {};
  if (headRow?.id) fields.mumin_id = String(headRow.id);
  fields.mumin_name = headRow?.full_name != null ? String(headRow.full_name) : null;

  const { data: members } = await supabase
    .from("mumineen")
    .select("full_name, not_attending, age")
    .eq("family_id", familyId)
    .eq("roster_active", true);
  const rows = (members ?? []) as { full_name: string | null; not_attending: boolean | null; age: number | null }[];
  fields.family_members = rows.map((m) => shortFamilyName(m.full_name)).filter(Boolean).join(", ");
  fields.eligible_family_count = String(rows.filter(isEligibleForCount).length);
  return fields;
}

type MuminRow = Record<string, unknown> & { id: string; family_id: string | null; whatsapp_e164: string | null; is_head?: boolean; not_attending?: boolean };

// `mumin_id` is exposed as a field (not a roster column) so per-recipient button payloads can bind
// {{Person.Id}} to it. eligible_family_count is added later, once families are aggregated.
function toRecipient(m: MuminRow): Recipient {
  const f = fieldsOf(m);
  // `mumin_id` (not a roster column) for button payloads; `mumin_name` aliases full_name so a
  // {{mumin_name}} field binding resolves (the templates use mumin_name; the roster column is full_name).
  return { phone: normalizePhone(m.whatsapp_e164 as string), familyId: m.family_id, muminId: m.id, fields: { ...f, mumin_id: m.id, mumin_name: f.full_name } };
}

// Resolve the recipient list for a daily RSVP send. `ind` audiences are per-mumin (their own number);
// `all_hof` / `fam` are one reachable number per family. Optionally drops anyone who already responded
// for that date. Returns `unresolvedIts` for the test audience.
export async function resolveNiyazAudience(opts: {
  date: string;
  audience: NiyazAudienceKind;
  its?: string[];
  onlyNonResponders?: boolean;
  level: NiyazLevel;
  // Default true (legacy: only families with a submitted registration). Pass false to target every
  // roster-active, not-attending=false family — the double-RSVP audience definition. NOTE: this flag
  // only governs `all_mumineen`; `all_adults` / `all_hof` apply their own local-vs-mehman
  // registration rule (locals always, mehman only if submitted) and ignore this flag.
  requireRegistered?: boolean;
}): Promise<{ recipients: Recipient[]; unresolvedIts: string[] }> {
  const supabase = getSupabaseAdmin();
  const sel = NIYAZ_SEL;
  let recipients: Recipient[] = [];
  const unresolvedIts: string[] = [];

  if (opts.audience === "specific_its") {
    const itsList = [...new Set((opts.its ?? []).map((s) => s.trim()).filter(Boolean))];
    if (itsList.length === 0) return { recipients: [], unresolvedIts: [] };
    // Paged so a large paste of ITS can't be silently capped at 1000 matches. Stable .order("id").
    const rows = await fetchAllRows<MuminRow & { its: string }>(() =>
      supabase.from("mumineen").select(sel).in("its", itsList).eq("roster_active", true).order("id", { ascending: true }) as unknown as Pageable<MuminRow & { its: string }>,
    );
    const foundIts = new Set(rows.map((r) => String(r.its)));
    for (const its of itsList) if (!foundIts.has(its)) unresolvedIts.push(its);
    for (const m of rows) {
      if (!m.whatsapp_e164) {
        unresolvedIts.push(String(m.its));
        continue;
      }
      recipients.push(toRecipient(m));
    }
    recipients = dedupeByPhone(recipients);
  } else if (opts.audience === "all_adults_hof") {
    // Every adult of the entered HOF families (by hof_its). Paged so a large HOF list isn't capped
    // at 1000 member rows by the PostgREST single-response limit. Stable .order("id").
    const hofList = [...new Set((opts.its ?? []).map((s) => s.trim()).filter(Boolean))];
    if (hofList.length === 0) return { recipients: [], unresolvedIts: [] };
    const rows = await fetchAllRows<MuminRow>(() =>
      supabase
        .from("mumineen")
        .select(sel)
        .in("hof_its", hofList)
        .eq("roster_active", true)
        .eq("not_attending", false)
        .eq("is_adult", true)
        .not("whatsapp_e164", "is", null)
        .order("id", { ascending: true }) as unknown as Pageable<MuminRow>,
    );
    recipients = dedupeByPhone(rows.map(toRecipient));
  } else {
    // Filter to active families via a server-side inner join instead of a huge .in(familyIds) list
    // (1000+ family UUIDs blew past the request URL limit, returning nothing).
    //
    // Registration handling depends on the audience:
    //   - all_adults / all_hof: include all LOCAL members regardless of registration, but only
    //     MEHMAN members whose family registration is `submitted`. This local-vs-mehman split is
    //     decided per-row in TS below (a PostgREST OR across the embedded families table is brittle),
    //     so no blanket registration filter is applied for these two.
    //   - all_mumineen: legacy behavior — require_registered (default true) requires a submitted
    //     registration for everyone.
    const selFam = `${sel}, families!inner(roster_active, registration_status)`;
    const conditionalReg = opts.audience === "all_adults" || opts.audience === "all_hof";
    // Page through ALL matching rows. PostgREST caps a single response at 1000 rows, so a bare
    // `await` silently truncated large audiences — "All Adults" (2k+ member rows) read as 1000 and,
    // after dedupe-by-phone, collapsed to ~930. fetchAllRows windows the query in 1000-row pages
    // (stable .order("id") so pages don't overlap), returning the full audience. `baseQuery` must
    // build a FRESH builder each call so .range() can be re-applied per page.
    const baseQuery = () => {
      let q = supabase
        .from("mumineen")
        .select(selFam)
        .eq("roster_active", true)
        .eq("not_attending", false)
        .not("whatsapp_e164", "is", null)
        .eq("families.roster_active", true)
        .order("id", { ascending: true });
      if (!conditionalReg && (opts.requireRegistered ?? true)) q = q.eq("families.registration_status", "submitted");
      // all_adults narrows to adults; all_mumineen / all_hof scan every reachable member.
      if (opts.audience === "all_adults") q = q.eq("is_adult", true);
      return q;
    };

    let rows = await fetchAllRows<MuminRow>(() => baseQuery() as unknown as Pageable<MuminRow>);

    if (conditionalReg) {
      // Mehman need a submitted family registration; Local (and any non-Mehman) members are included
      // regardless. families!inner guarantees the embed is present. Runs BEFORE the all_hof family
      // collapse so an unsubmitted-mehman family drops out before its head is picked as the rep.
      rows = rows.filter((m) => {
        const reg = (m as { families?: { registration_status?: string | null } | null }).families?.registration_status ?? null;
        return (m as { local_mehman?: string | null }).local_mehman !== "Mehman" || reg === "submitted";
      });
    }

    if (opts.audience === "all_hof") {
      const byFamily = new Map<string, MuminRow>();
      for (const m of rows) {
        const existing = byFamily.get(m.family_id!);
        if (!existing || m.is_head) byFamily.set(m.family_id!, m);
      }
      recipients = dedupeByPhone([...byFamily.values()].map(toRecipient));
    } else {
      // all_mumineen / all_adults — every (adult) member with their own number.
      recipients = dedupeByPhone(rows.map(toRecipient));
    }
  }

  // Attach computed family fields (family_members + eligible_family_count) per recipient.
  await attachFamilyFields(recipients);

  if (opts.onlyNonResponders) {
    const instanceIds = (await getEvents()).filter((e) => e.eventDate === opts.date).map((e) => e.id);
    if (instanceIds.length > 0) {
      // Paged: a day's niyaz_rsvp rows (one per attending mumin per meal) run into the thousands, well
      // past the 1000-row cap. A truncated `answered` set would wrongly KEEP families who already
      // responded, so the "not responded" audience must read every response row. Stable .order("id").
      const responses = await fetchAllRows<{ family_id: string | null }>(() =>
        supabase
          .from("niyaz_rsvp")
          .select("family_id")
          .in("registration_instance_id", instanceIds)
          .in("source", ["whatsapp", "admin"])
          .order("id", { ascending: true }) as unknown as Pageable<{ family_id: string | null }>,
      );
      // Family-level: once any member of a family responds for the day, the whole family is excluded
      // (a family RSVP stamps every member with source='whatsapp').
      const answered = new Set(responses.map((r) => r.family_id));
      recipients = recipients.filter((r) => !answered.has(r.familyId));
    }
  }

  return { recipients, unresolvedIts };
}

// Attach computed family fields per recipient: `family_members` (the family's member names, for the
// {{family_members}} template variable) and `eligible_family_count` (roster-active members not marked
// not-attending, for the {{EligibleFamilyCount}} button token / default attending count). Shared by
// the audience resolver and the CSV-upload path so both personalize identically.
async function attachFamilyFields(recipients: Recipient[]): Promise<void> {
  const supabase = getSupabaseAdmin();
  const famIds = [...new Set(recipients.map((r) => r.familyId).filter(Boolean))] as string[];
  const namesByFam = new Map<string, string[]>();
  const eligibleByFam = new Map<string, number>();
  // Chunk the family lookup — a single .in() over 1000+ family ids exceeds the request URL limit.
  // Each chunk is itself paged with fetchAllRows: 300 families can hold >1000 member rows, which the
  // 1000-row PostgREST cap would silently truncate (under-counting eligible_family_count and dropping
  // family_members names). Stable .order("id") keeps the pages non-overlapping.
  type FamMemberRow = { family_id: string; full_name: string | null; not_attending: boolean | null; age: number | null };
  const CHUNK = 300;
  for (let i = 0; i < famIds.length; i += CHUNK) {
    const chunk = famIds.slice(i, i + CHUNK);
    const data = await fetchAllRows<FamMemberRow>(() =>
      supabase
        .from("mumineen")
        .select("family_id, full_name, not_attending, age")
        .in("family_id", chunk)
        .eq("roster_active", true)
        .order("id", { ascending: true }) as unknown as Pageable<FamMemberRow>,
    );
    for (const m of data) {
      if (m.full_name) {
        const arr = namesByFam.get(m.family_id) ?? [];
        arr.push(shortFamilyName(m.full_name));
        namesByFam.set(m.family_id, arr);
      }
      if (isEligibleForCount(m)) eligibleByFam.set(m.family_id, (eligibleByFam.get(m.family_id) ?? 0) + 1);
    }
  }
  for (const r of recipients) {
    // No family → the recipient stands for themselves (eligible count 1).
    const eligible = r.familyId ? eligibleByFam.get(r.familyId) ?? 0 : 1;
    r.fields = {
      ...(r.fields ?? {}),
      family_members: r.familyId ? (namesByFam.get(r.familyId) ?? []).join(", ") : r.fields?.family_members ?? "",
      eligible_family_count: String(eligible),
    };
  }
}

// Resolve the recipient list for a CSV-upload send. The CSV is the same format the audience export
// emits (header-matched, WhatsApp column required) — see parseAudienceCsv. Each parsed row is then
// matched back to the roster by its WhatsApp number so the recipient carries the SAME identity and
// computed fields a resolved audience would (family_id, mumin_id, hof_its, eligible_family_count, …),
// and the per-recipient RSVP buttons personalize correctly. CSV-provided field values win over the
// roster; rows with no roster match are still sent (with their CSV fields + eligible_family_count 1).
export async function resolveNiyazCsvRecipients(csvText: string): Promise<AudienceCsvResult> {
  const parsed = parseAudienceCsv(csvText);
  if (parsed.error || parsed.recipients.length === 0) return parsed;

  const byPhone = await rosterByPhoneForNiyaz(parsed.recipients.map((r) => r.phone));
  for (const r of parsed.recipients) {
    const m = byPhone.get(normalizePhone(r.phone));
    if (!m) continue;
    r.familyId = (m.family_id as string | null) ?? null;
    r.muminId = r.muminId ?? m.id;
    // Roster fields as the base; non-empty CSV values override (the upload is the source of truth).
    const merged: Record<string, string | null> = fieldsOf(m);
    for (const [k, v] of Object.entries(r.fields ?? {})) {
      if (v != null && String(v).trim() !== "") merged[k] = v;
    }
    r.fields = { ...merged, mumin_id: m.id, mumin_name: merged.full_name };
  }
  await attachFamilyFields(parsed.recipients);
  return parsed;
}

// Look up roster identity (the NIYAZ_SEL columns) for a set of phone numbers, keyed by normalized
// phone. Matches the member's OWN whatsapp_e164 — the column the audience export emits — so a
// re-uploaded export round-trips. Chunked + paged to stay under the URL/row limits. Stored numbers
// are inconsistent about the leading "+", so both forms are queried.
async function rosterByPhoneForNiyaz(phones: string[]): Promise<Map<string, MuminRow>> {
  const supabase = getSupabaseAdmin();
  const out = new Map<string, MuminRow>();
  const norm = [...new Set(phones.map(normalizePhone))].filter(Boolean);
  if (norm.length === 0) return out;
  const variants = (ps: string[]) => [...new Set(ps.flatMap((p) => [p, p.replace(/^\+/, "")]))];
  const CHUNK = 200;
  for (let i = 0; i < norm.length; i += CHUNK) {
    const chunk = variants(norm.slice(i, i + CHUNK));
    const rows = await fetchAllRows<MuminRow>(() =>
      supabase
        .from("mumineen")
        .select(NIYAZ_SEL)
        .in("whatsapp_e164", chunk)
        .eq("roster_active", true)
        .order("id", { ascending: true }) as unknown as Pageable<MuminRow>,
    );
    for (const m of rows) {
      if (!m.whatsapp_e164) continue;
      const p = normalizePhone(m.whatsapp_e164);
      if (!out.has(p)) out.set(p, m);
    }
  }
  return out;
}

// --- Free-text head-count prompts (date↔reply mapping) ---

// Log a pending head-count prompt per recipient when the family free-text template is sent, so a
// later numeric reply can be tied back to this date.
export async function createHeadCountPrompts(rows: { phone: string; familyId: string | null }[], date: string): Promise<void> {
  if (rows.length === 0) return;
  await getSupabaseAdmin()
    .from("niyaz_rsvp_prompts")
    .insert(rows.map((r) => ({ phone_e164: r.phone, family_id: r.familyId, event_date: date })));
}

// Create a single prompt for a phone (used after unregistered button taps so the next numeric
// reply is tied to this date). family_id is null for unregistered callers.
export async function createPrompt(opts: { phone: string; familyId: string | null; eventDate: string }): Promise<void> {
  await getSupabaseAdmin()
    .from("niyaz_rsvp_prompts")
    .insert({ phone_e164: opts.phone, family_id: opts.familyId, event_date: opts.eventDate });
}

export type OpenPrompt = { id: string; family_id: string | null; event_date: string };

// The most recent unconsumed head-count prompt for a phone (within ~2 days).
export async function findOpenPrompt(phone: string): Promise<OpenPrompt | null> {
  const since = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await getSupabaseAdmin()
    .from("niyaz_rsvp_prompts")
    .select("id, family_id, event_date")
    .eq("phone_e164", phone)
    .is("consumed_at", null)
    .gte("sent_at", since)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as OpenPrompt | null) ?? null;
}

export async function consumePrompt(id: string): Promise<void> {
  await getSupabaseAdmin().from("niyaz_rsvp_prompts").update({ consumed_at: new Date().toISOString() }).eq("id", id);
}

// Day label, meal label, and the quick-reply button payloads for a date. Both-meal days get four
// buttons (both/lunch/dinner/none); single-meal days (Pehli Raat, Jun 24) get two (attending/not),
// so the chosen template's button count must match.
export async function buildNiyazSend(
  date: string,
  level: NiyazLevel,
): Promise<{ dayLabel: string; mealLabel: string; quickReplyButtons: { index: number; payload: string }[] }> {
  const dayEvents = (await getEvents()).filter((e) => e.eventDate === date);
  const dayLabel = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

  const hasLunch = dayEvents.some((e) => e.meal === "lunch");
  const hasDinner = dayEvents.some((e) => e.meal === "dinner");
  const mealLabel = dayEvents.length === 1 ? dayEvents[0].title || "Niyaz" : "lunch & dinner";

  const p = (scope: string) => `niyaz|${level}|${scope}|${date}`;
  const quickReplyButtons =
    hasLunch && hasDinner
      ? [
          { index: 0, payload: p("both") },
          { index: 1, payload: p("lunch") },
          { index: 2, payload: p("dinner") },
          { index: 3, payload: p("none") },
        ]
      : [
          { index: 0, payload: p("both") },
          { index: 1, payload: p("none") },
        ];

  return { dayLabel, mealLabel, quickReplyButtons };
}
