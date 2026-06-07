import { NextRequest, NextResponse } from "next/server";

import { canViewRegistrations, isAdminOrLeadership } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Departments whose members can see EVERY department's summary (plus the all-up).
const SEE_ALL_DEPARTMENTS = ["Project Management", "Leadership"];

// GET /api/admin/department-digest?date=YYYY-MM-DD — stored briefings for a day (defaults to the
// most recent day). Any internal user may call it; results are SCOPED: a member sees only their
// own departments' summaries, while admin/leadership and Project Management / Leadership members
// see all departments plus the all-up. Read-only.
export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, canViewRegistrations);
  if (auth instanceof NextResponse) return auth;
  const caller = auth.caller;
  const supabase = getSupabaseAdmin();

  const seesAll =
    isAdminOrLeadership(caller.portal) ||
    caller.departments.some((d) => SEE_ALL_DEPARTMENTS.includes(d.department_name));
  const myDeptIds = new Set(caller.departments.map((d) => d.department_id));

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
    .select("department_id, summary_date, metrics, ai_briefing, ai_briefing_short, departments(name)")
    .eq("summary_date", date);

  const rows = ((data ?? []) as unknown as {
    department_id: string | null;
    ai_briefing: string | null;
    ai_briefing_short: string | null;
    metrics: unknown;
    departments: { name: string } | { name: string }[] | null;
  }[])
    // Scope: non-"see all" callers only see their own departments (and never the all-up).
    .filter((r) => (seesAll ? true : r.department_id !== null && myDeptIds.has(r.department_id)))
    .map((r) => {
      const deptName = Array.isArray(r.departments) ? r.departments[0]?.name : r.departments?.name;
      return {
        department_id: r.department_id,
        department_name: r.department_id ? deptName ?? "Unknown" : "All-up (all departments)",
        ai_briefing: r.ai_briefing,
        ai_briefing_short: r.ai_briefing_short,
        metrics: r.metrics,
      };
    });

  // All-up first, then departments alphabetically.
  rows.sort((a, b) => (a.department_id === null ? -1 : b.department_id === null ? 1 : a.department_name.localeCompare(b.department_name)));

  return NextResponse.json({ date, summaries: rows, sees_all: seesAll });
}
