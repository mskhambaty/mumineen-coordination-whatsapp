import { NextRequest, NextResponse } from "next/server";

import { canManageInternalTools } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

// GET /api/admin/department-digest?date=YYYY-MM-DD — stored department + all-up briefings for a day
// (defaults to the most recent day with summaries). Admin/leadership + managers (matches the
// "manage" nav gate). Read-only.
export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, canManageInternalTools);
  if (auth instanceof NextResponse) return auth;
  const supabase = getSupabaseAdmin();

  let date = req.nextUrl.searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const { data: latest } = await supabase
      .from("department_daily_summaries")
      .select("summary_date")
      .order("summary_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    date = latest?.summary_date ?? new Date().toISOString().slice(0, 10);
  }

  const { data } = await supabase
    .from("department_daily_summaries")
    .select("department_id, summary_date, metrics, ai_briefing, departments(name)")
    .eq("summary_date", date);

  const rows = ((data ?? []) as unknown as {
    department_id: string | null;
    ai_briefing: string | null;
    metrics: unknown;
    departments: { name: string } | { name: string }[] | null;
  }[]).map((r) => {
    const deptName = Array.isArray(r.departments) ? r.departments[0]?.name : r.departments?.name;
    return {
      department_id: r.department_id,
      department_name: r.department_id ? deptName ?? "Unknown" : "All-up (leadership)",
      ai_briefing: r.ai_briefing,
      metrics: r.metrics,
    };
  });

  // All-up first, then departments alphabetically.
  rows.sort((a, b) => (a.department_id === null ? -1 : b.department_id === null ? 1 : a.department_name.localeCompare(b.department_name)));

  return NextResponse.json({ date, summaries: rows });
}
