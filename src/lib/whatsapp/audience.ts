import { optionalEnv } from "@/lib/env";
import { getSupabaseAdmin } from "@/lib/supabase/server";

// Audience resolution for the manual template-send console. Each audience key resolves to a set of
// recipients, always DEDUPED by phone number (one message max per number). A recipient is "in
// window" if the number messaged us in the last 24h — those template sends are free; the rest are
// paid. Counts/cost are previewed before send and recorded on the broadcast.

export const AUDIENCE_KEYS = [
  "selected_users",
  "chicago_committee",
  "arrived_hof",
  "registered_hof",
  "all_members",
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
};

export type Recipient = { phone: string; familyId: string | null };

const WINDOW_MS = 24 * 60 * 60 * 1000;

function normalizePhone(input: string): string {
  const digits = input.replace(/[^\d]/g, "");
  return digits ? `+${digits}` : input;
}

// Dedupe a candidate list by phone, keeping the first family association seen.
function dedupeByPhone(candidates: Recipient[]): Recipient[] {
  const byPhone = new Map<string, Recipient>();
  for (const c of candidates) {
    if (!c.phone) continue;
    const phone = normalizePhone(c.phone);
    if (!byPhone.has(phone)) byPhone.set(phone, { phone, familyId: c.familyId });
  }
  return [...byPhone.values()];
}

// Resolve the raw (deduped) recipient list for an audience. `selectedUserIds` is only used for the
// "selected_users" key.
export async function resolveAudience(key: AudienceKey, selectedUserIds: string[] = []): Promise<Recipient[]> {
  const supabase = getSupabaseAdmin();

  if (key === "selected_users") {
    if (selectedUserIds.length === 0) return [];
    const { data } = await supabase
      .from("whatsapp_users")
      .select("phone_e164")
      .in("id", selectedUserIds)
      .eq("status", "active");
    return dedupeByPhone(((data ?? []) as { phone_e164: string }[]).map((u) => ({ phone: u.phone_e164, familyId: null })));
  }

  if (key === "chicago_committee") {
    const { data } = await supabase
      .from("whatsapp_users")
      .select("phone_e164")
      .in("role", ["committee", "admin"])
      .eq("status", "active");
    return dedupeByPhone(((data ?? []) as { phone_e164: string }[]).map((u) => ({ phone: u.phone_e164, familyId: null })));
  }

  // The remaining audiences are roster families. Pull active, non-cancelled families and one
  // reachable number each (head member's WhatsApp, else any member's).
  if (key === "registered_hof" || key === "arrived_hof") {
    const { data: families } = await supabase
      .from("families")
      .select("id, registration_status, roster_active, cancelled_at")
      .eq("roster_active", true)
      .is("cancelled_at", null)
      .in("registration_status", ["submitted", "confirmed"]);

    const familyIds = ((families ?? []) as { id: string }[]).map((f) => f.id);
    if (familyIds.length === 0) return [];

    const { data: members } = await supabase
      .from("mumineen")
      .select("family_id, whatsapp_e164, is_head, arrival_at, not_attending")
      .in("family_id", familyIds)
      .eq("roster_active", true)
      .not("whatsapp_e164", "is", null);

    type M = { family_id: string; whatsapp_e164: string; is_head: boolean; arrival_at: string | null; not_attending: boolean };
    const byFamily = new Map<string, { phone: string; arrived: boolean }>();
    const now = Date.now();
    for (const m of (members ?? []) as M[]) {
      if (m.not_attending) continue;
      const arrived = m.arrival_at ? new Date(m.arrival_at).getTime() <= now : false;
      const existing = byFamily.get(m.family_id);
      // Prefer the head member's number; otherwise take the first seen.
      if (!existing || m.is_head) {
        byFamily.set(m.family_id, { phone: m.whatsapp_e164, arrived: arrived || (existing?.arrived ?? false) });
      } else if (arrived && !existing.arrived) {
        existing.arrived = true;
      }
    }

    const recipients: Recipient[] = [];
    for (const [familyId, info] of byFamily) {
      if (key === "arrived_hof" && !info.arrived) continue;
      recipients.push({ phone: info.phone, familyId });
    }
    return dedupeByPhone(recipients);
  }

  // all_members: every attending roster member with a number, deduped by phone.
  const { data: members } = await supabase
    .from("mumineen")
    .select("family_id, whatsapp_e164, not_attending, roster_active")
    .eq("roster_active", true)
    .eq("not_attending", false)
    .not("whatsapp_e164", "is", null);
  return dedupeByPhone(
    ((members ?? []) as { family_id: string | null; whatsapp_e164: string }[]).map((m) => ({
      phone: m.whatsapp_e164,
      familyId: m.family_id,
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
  recipients: { phone: string; familyId: string | null; inWindow: boolean }[];
};

// Resolve an audience and split it into free (in-window) vs paid, with an estimated cost.
export async function previewAudience(key: AudienceKey, selectedUserIds: string[] = []): Promise<AudiencePreview> {
  const [recipients, inWindow] = await Promise.all([resolveAudience(key, selectedUserIds), getInWindowPhones()]);
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
