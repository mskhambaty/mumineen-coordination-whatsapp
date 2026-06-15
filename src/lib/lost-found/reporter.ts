import { getSupabaseAdmin } from "@/lib/supabase/server";

export type LostFoundReporter = {
  userId: string | null;
  muminId: string | null;
  name: string | null;
  phoneE164: string;
  its: string | null;
};

type MuminRow = {
  id: string;
  its: string | null;
  full_name: string | null;
  is_head: boolean | null;
};

export async function resolveLostFoundReporter(
  phoneE164: string,
  supplied: { name?: string | null; its?: string | null } = {},
): Promise<LostFoundReporter> {
  const supabase = getSupabaseAdmin();
  const [{ data: user }, { data: links }] = await Promise.all([
    supabase
      .from("whatsapp_users")
      .select("id, display_name")
      .eq("phone_e164", phoneE164)
      .maybeSingle(),
    supabase
      .from("mumin_phone_links")
      .select("mumin_id, is_primary")
      .eq("phone_e164", phoneE164),
  ]);

  const linkRows = (links ?? []) as Array<{ mumin_id: string; is_primary: boolean }>;
  let members: MuminRow[] = [];
  if (linkRows.length > 0) {
    const { data } = await supabase
      .from("mumineen")
      .select("id, its, full_name, is_head")
      .in("id", linkRows.map((link) => link.mumin_id))
      .eq("roster_active", true);
    members = (data ?? []) as MuminRow[];
  } else {
    const { data } = await supabase
      .from("mumineen")
      .select("id, its, full_name, is_head")
      .eq("whatsapp_e164", phoneE164)
      .eq("roster_active", true);
    members = (data ?? []) as MuminRow[];
  }

  const primaryIds = new Set(linkRows.filter((link) => link.is_primary).map((link) => link.mumin_id));
  const member =
    members.find((candidate) => primaryIds.has(candidate.id)) ??
    members.find((candidate) => candidate.is_head) ??
    members[0] ??
    null;

  return {
    userId: (user?.id as string | undefined) ?? null,
    muminId: member?.id ?? null,
    name: (member?.full_name ?? user?.display_name ?? supplied.name?.trim()) || null,
    phoneE164,
    its: (member?.its ?? supplied.its?.trim()) || null,
  };
}
