import { getSupabaseAdmin } from "@/lib/supabase/server";

// Resolve a WhatsApp phone number to the roster family it belongs to, so the agent's
// RSVP/feedback tools can act on behalf of the whole family. A phone may be linked to
// several members (shared numbers); we take the linked member and read their family.

export type ResolvedFamily = {
  familyId: string;
  muminId: string;
  hofIts: string;
  displayName: string | null;
};

function normalizePhone(input: string): string {
  const digits = input.replace(/[^\d]/g, "");
  return digits ? `+${digits}` : input;
}

// Returns the family for a phone, or null when the number is not linked to any
// registered roster member.
export async function resolveFamilyForPhone(phone: string): Promise<ResolvedFamily | null> {
  const supabase = getSupabaseAdmin();
  const normalized = normalizePhone(phone);

  const { data: link } = await supabase
    .from("mumin_phone_links")
    .select("mumin_id")
    .eq("phone_e164", normalized)
    .order("is_primary", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (link?.mumin_id) {
    const { data: mumin } = await supabase
      .from("mumineen")
      .select("id, family_id, hof_its, full_name, roster_active")
      .eq("id", link.mumin_id)
      .maybeSingle();

    if (mumin?.family_id && mumin.roster_active !== false) {
      return {
        familyId: mumin.family_id,
        muminId: mumin.id,
        hofIts: mumin.hof_its,
        displayName: mumin.full_name ?? null,
      };
    }
  }

  // Fallback: the phone wasn't in mumin_phone_links (e.g. a roster-seeded number that never got a
  // registration link). Match directly on the roster member's own WhatsApp number so these callers
  // are still recognized as their family instead of being treated as unregistered. Prefer the head
  // of family for a shared number.
  return resolveFamilyByWhatsappNumber(normalized);
}

async function resolveFamilyByWhatsappNumber(normalized: string): Promise<ResolvedFamily | null> {
  const supabase = getSupabaseAdmin();
  const { data: members } = await supabase
    .from("mumineen")
    .select("id, family_id, hof_its, full_name, is_head")
    .eq("whatsapp_e164", normalized)
    .eq("roster_active", true);

  const rows = (members ?? []) as { id: string; family_id: string | null; hof_its: string; full_name: string | null; is_head: boolean | null }[];
  const withFamily = rows.filter((m) => m.family_id);
  if (withFamily.length === 0) return null;

  const chosen = withFamily.find((m) => m.is_head) ?? withFamily[0];
  return {
    familyId: chosen.family_id as string,
    muminId: chosen.id,
    hofIts: chosen.hof_its,
    displayName: chosen.full_name ?? null,
  };
}
