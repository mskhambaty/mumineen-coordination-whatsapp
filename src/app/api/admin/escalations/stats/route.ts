import { NextRequest, NextResponse } from "next/server";

import { canAccessInbox } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// GET /api/admin/escalations/stats — KPI stats for the inbox header
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, canAccessInbox);
  if (auth instanceof NextResponse) return auth;

  const supabase = getSupabaseAdmin();

  // Fetch all active escalation sessions (not 'none', not 'resolved')
  // Plus legacy tickets where escalation_stage='none' but escalation_status='pending'
  const { data: sessions } = await supabase
    .from("conversation_sessions")
    .select("id, escalation_stage, escalation_status, escalation_sla_deadline, escalated_at, escalation_assigned_at")
    .or("escalation_stage.neq.none,and(escalation_stage.eq.none,escalation_status.eq.pending)");

  const now = new Date();
  const active = (sessions ?? []).filter(
    (s) => s.escalation_stage !== "resolved" || (s.escalation_stage === "none" && s.escalation_status === "pending"),
  );

  const pendingCount = active.filter(
    (s) => s.escalation_stage === "pending" || (s.escalation_stage === "none" && s.escalation_status === "pending"),
  ).length;

  const breachingCount = active.filter((s) => {
    if (!s.escalation_sla_deadline) return false;
    return new Date(s.escalation_sla_deadline) < now;
  }).length;

  // Avg pickup time: from escalated_at → escalation_assigned_at for picked-up tickets
  const pickedUp = (sessions ?? []).filter(
    (s) => s.escalation_assigned_at && s.escalated_at,
  );
  let avgPickupMinutes: number | null = null;
  if (pickedUp.length > 0) {
    const totalMinutes = pickedUp.reduce((sum, s) => {
      const diff = new Date(s.escalation_assigned_at!).getTime() - new Date(s.escalated_at!).getTime();
      return sum + diff / 60000;
    }, 0);
    avgPickupMinutes = Math.round(totalMinutes / pickedUp.length);
  }

  // Resolved today count
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const { count: resolvedTodayCount } = await supabase
    .from("escalation_activity_log")
    .select("id", { count: "exact", head: true })
    .eq("action", "resolved")
    .gte("created_at", dayAgo);

  return NextResponse.json({
    stats: {
      open_count: active.length,
      pending_count: pendingCount,
      breaching_count: breachingCount,
      avg_pickup_minutes: avgPickupMinutes,
      resolved_today_count: resolvedTodayCount ?? 0,
    },
  });
}
