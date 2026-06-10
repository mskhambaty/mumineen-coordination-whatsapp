import { NextRequest, NextResponse } from "next/server";

import { canAccessInbox } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ departmentId: string }> };

// Returns department contacts from two sources:
// 1. department_contacts table (reference list, can be external people)
// 2. department_members with contact_for_issues = true (portal users)
export async function GET(req: NextRequest, { params }: RouteContext) {
  const auth = await requirePortalCaller(req, canAccessInbox);
  if (auth instanceof NextResponse) return auth;

  const { departmentId } = await params;
  const supabase = getSupabaseAdmin();

  // Source 1: dedicated reference contacts (may not be portal users).
  const { data: refContacts } = await supabase
    .from("department_contacts")
    .select("id, name, role, phone_e164, email, notes, display_order")
    .eq("department_id", departmentId)
    .order("display_order", { ascending: true });

  // Source 2: active department members flagged as issue contacts.
  const { data: memberRows } = await supabase
    .from("department_members")
    .select("dept_role, user:whatsapp_users(id, display_name, email, phone_e164)")
    .eq("department_id", departmentId)
    .eq("is_active", true)
    .eq("contact_for_issues", true);

  type MemberRow = {
    dept_role: string;
    user: { id: string; display_name: string | null; email: string | null; phone_e164: string | null } |
          { id: string; display_name: string | null; email: string | null; phone_e164: string | null }[] | null;
  };

  const memberContacts = ((memberRows ?? []) as unknown as MemberRow[])
    .map((row) => {
      const user = Array.isArray(row.user) ? row.user[0] : row.user;
      if (!user) return null;
      return {
        user_id: user.id,
        name: user.display_name,
        email: user.email,
        phone: user.phone_e164,
        dept_role: row.dept_role,
      };
    })
    .filter(Boolean);

  // Sort members: hod first, then pm, then member.
  const roleOrder: Record<string, number> = { hod: 0, pm: 1, member: 2 };
  memberContacts.sort((a, b) => (roleOrder[a!.dept_role] ?? 9) - (roleOrder[b!.dept_role] ?? 9));

  return NextResponse.json({
    reference_contacts: refContacts ?? [],
    member_contacts: memberContacts,
  });
}
