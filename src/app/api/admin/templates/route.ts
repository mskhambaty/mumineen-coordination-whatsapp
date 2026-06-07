import { NextRequest, NextResponse } from "next/server";

import { requireAdminLeadership } from "@/lib/api/auth";
import { listMessageTemplates } from "@/lib/meta/whatsapp";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { describeTemplate } from "@/lib/whatsapp/templates";

export const runtime = "nodejs";

// GET /api/admin/templates — data for the manual send console: the approved Meta templates
// (described) plus the committee/admin users selectable as a test audience. Admin/leadership only.
// No PII (phone numbers) in the response; selectable users are id + name only.
export async function GET(req: NextRequest) {
  if (!(await requireAdminLeadership(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const all = await listMessageTemplates().catch(() => []);
  const templates = all.filter((t) => t.status?.toUpperCase() === "APPROVED").map(describeTemplate);

  const { data: users } = await getSupabaseAdmin()
    .from("whatsapp_users")
    .select("id, display_name, role")
    .in("role", ["committee", "admin"])
    .eq("status", "active")
    .order("display_name", { ascending: true });

  return NextResponse.json({
    templates,
    selectable_users: ((users ?? []) as { id: string; display_name: string | null; role: string }[]).map((u) => ({
      id: u.id,
      name: u.display_name ?? "(no name)",
      role: u.role,
    })),
  });
}
