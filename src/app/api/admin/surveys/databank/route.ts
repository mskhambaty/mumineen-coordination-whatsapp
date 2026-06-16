import { NextRequest, NextResponse } from "next/server";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

// GET /api/admin/surveys/databank — sections (with their questions) + target groups, for the
// admin console's Databank/Groups/Compose tabs.
export async function GET(req: NextRequest) {
  const guard = await requirePortalCaller(req, isAdminOrLeadership);
  if (guard instanceof NextResponse) return guard;
  const supabase = getSupabaseAdmin();

  const [{ data: sections }, { data: questions }, { data: groups }] = await Promise.all([
    supabase.from("survey_sections").select("id, key, title, description, area, is_general, sort_order, active").order("sort_order"),
    supabase.from("survey_questions").select("id, section_id, text, type, options, negative_values, polarity, is_general, sort_order, active").eq("active", true).order("sort_order"),
    supabase.from("survey_groups").select("id, name, description, rules, area_focus, active").eq("active", true).order("name"),
  ]);

  const qBySection = new Map<string, unknown[]>();
  for (const q of (questions ?? []) as { section_id: string }[]) {
    const list = qBySection.get(q.section_id) ?? [];
    list.push(q);
    qBySection.set(q.section_id, list);
  }
  const sectionsOut = ((sections ?? []) as { id: string }[]).map((s) => ({ ...s, questions: qBySection.get(s.id) ?? [] }));

  return NextResponse.json({ sections: sectionsOut, groups: groups ?? [] });
}
