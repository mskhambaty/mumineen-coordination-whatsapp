import { NextResponse } from "next/server";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { getSupabaseAdmin } from "@/lib/supabase/server";

// Resolve the acting portal user (body user_id) and require admin/leadership.
// Returns an error response to send, or null when allowed.
export async function requireLeadership(userId: string): Promise<NextResponse | null> {
  if (!userId) {
    return NextResponse.json({ error: "Missing user id" }, { status: 400 });
  }
  const { data: user } = await getSupabaseAdmin()
    .from("whatsapp_users")
    .select("id, role, global_role")
    .eq("id", userId)
    .maybeSingle();
  if (!user || !isAdminOrLeadership(user)) {
    return NextResponse.json({ error: "Only admins or leadership can manage relay updates." }, { status: 403 });
  }
  return null;
}
