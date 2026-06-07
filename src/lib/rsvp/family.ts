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

  if (!link?.mumin_id) return null;

  const { data: mumin } = await supabase
    .from("mumineen")
    .select("id, family_id, hof_its, full_name, roster_active")
    .eq("id", link.mumin_id)
    .maybeSingle();

  if (!mumin?.family_id || mumin.roster_active === false) return null;

  return {
    familyId: mumin.family_id,
    muminId: mumin.id,
    hofIts: mumin.hof_its,
    displayName: mumin.full_name ?? null,
  };
}
