import { getEvents, type NiyazLevel } from "@/lib/rsvp/meal-rsvp";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { Recipient } from "@/lib/whatsapp/audience";
import { MAPPABLE_FIELDS } from "@/lib/whatsapp/templates";

// Audience resolution + send context for the admin-triggered daily Niyaz RSVP templates. The button
// payloads encode `niyaz|<level>|<scope>|<date>` so a tap is self-describing on the inbound side.

const MAPPABLE_COLS = MAPPABLE_FIELDS.map((f) => f.key);

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

export type NiyazAudienceKind = "specific_its" | "all_mumineen" | "all_hof" | "all_adults";

async function registeredFamilyIds(): Promise<string[]> {
  const { data } = await getSupabaseAdmin()
    .from("families")
    .select("id")
    .eq("roster_active", true)
    .is("cancelled_at", null)
    .in("registration_status", ["submitted", "confirmed"]);
  return ((data ?? []) as { id: string }[]).map((f) => f.id);
}

type MuminRow = Record<string, unknown> & { id: string; family_id: string | null; whatsapp_e164: string | null; is_head?: boolean; not_attending?: boolean };

function toRecipient(m: MuminRow): Recipient {
  return { phone: normalizePhone(m.whatsapp_e164 as string), familyId: m.family_id, muminId: m.id, fields: fieldsOf(m) };
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
}): Promise<{ recipients: Recipient[]; unresolvedIts: string[] }> {
  const supabase = getSupabaseAdmin();
  const sel = `id, family_id, whatsapp_e164, is_head, is_adult, not_attending, ${MAPPABLE_COLS.join(", ")}`;
  let recipients: Recipient[] = [];
  const unresolvedIts: string[] = [];

  if (opts.audience === "specific_its") {
    const itsList = [...new Set((opts.its ?? []).map((s) => s.trim()).filter(Boolean))];
    if (itsList.length === 0) return { recipients: [], unresolvedIts: [] };
    const { data } = await supabase.from("mumineen").select(sel).in("its", itsList).eq("roster_active", true);
    const rows = (data ?? []) as unknown as (MuminRow & { its: string })[];
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
  } else {
    const familyIds = await registeredFamilyIds();
    if (familyIds.length === 0) return { recipients: [], unresolvedIts: [] };

    if (opts.audience === "all_hof") {
      const { data } = await supabase
        .from("mumineen")
        .select(sel)
        .in("family_id", familyIds)
        .eq("roster_active", true)
        .eq("not_attending", false)
        .not("whatsapp_e164", "is", null);
      const byFamily = new Map<string, MuminRow>();
      for (const m of (data ?? []) as unknown as MuminRow[]) {
        const existing = byFamily.get(m.family_id!);
        if (!existing || m.is_head) byFamily.set(m.family_id!, m);
      }
      recipients = dedupeByPhone([...byFamily.values()].map(toRecipient));
    } else {
      // all_mumineen / all_adults — every (adult) member with their own number.
      let q = supabase
        .from("mumineen")
        .select(sel)
        .in("family_id", familyIds)
        .eq("roster_active", true)
        .eq("not_attending", false)
        .not("whatsapp_e164", "is", null);
      if (opts.audience === "all_adults") q = q.eq("is_adult", true);
      const { data } = await q;
      recipients = dedupeByPhone(((data ?? []) as unknown as MuminRow[]).map(toRecipient));
    }
  }

  // Attach a computed `family_members` field (the family's member names) so the family template's
  // {{family_members}} variable can be personalized per recipient.
  const famIds = [...new Set(recipients.map((r) => r.familyId).filter(Boolean))] as string[];
  if (famIds.length > 0) {
    const { data } = await supabase.from("mumineen").select("family_id, full_name").in("family_id", famIds).eq("roster_active", true);
    const byFam = new Map<string, string[]>();
    for (const m of (data ?? []) as { family_id: string; full_name: string | null }[]) {
      if (!m.full_name) continue;
      const arr = byFam.get(m.family_id) ?? [];
      arr.push(m.full_name);
      byFam.set(m.family_id, arr);
    }
    for (const r of recipients) {
      if (r.familyId) r.fields = { ...(r.fields ?? {}), family_members: (byFam.get(r.familyId) ?? []).join(", ") };
    }
  }

  if (opts.onlyNonResponders) {
    const instanceIds = (await getEvents()).filter((e) => e.eventDate === opts.date).map((e) => e.id);
    if (instanceIds.length > 0) {
      const { data } = await supabase
        .from("niyaz_rsvp")
        .select("mumin_id, family_id")
        .in("registration_instance_id", instanceIds)
        .in("source", ["whatsapp", "admin"]);
      const rows = (data ?? []) as { mumin_id: string; family_id: string | null }[];
      if (opts.level === "fam") {
        const answered = new Set(rows.map((r) => r.family_id));
        recipients = recipients.filter((r) => !answered.has(r.familyId));
      } else {
        const answered = new Set(rows.map((r) => r.mumin_id));
        recipients = recipients.filter((r) => !(r.muminId && answered.has(r.muminId)));
      }
    }
  }

  return { recipients, unresolvedIts };
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
