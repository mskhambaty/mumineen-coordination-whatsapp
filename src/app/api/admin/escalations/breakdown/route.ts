import { NextRequest, NextResponse } from "next/server";

import { requireAdminKey } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

type Row = {
  escalation_category: string | null;
  escalation_priority: string | null;
  escalation_status: string | null;
  escalation_reason: string | null;
  escalated_at: string | null;
};

// GET /api/admin/escalations/breakdown — why chats get escalated: counts by category/priority,
// plus the most recent reasons, aggregated from conversation_sessions.
export async function GET(req: NextRequest) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data, error } = await getSupabaseAdmin()
    .from("conversation_sessions")
    .select("escalation_category, escalation_priority, escalation_status, escalation_reason, escalated_at")
    .not("escalation_status", "is", null)
    .order("escalated_at", { ascending: false })
    .limit(2000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as Row[];
  const tally = (key: keyof Row, fallback: string) => {
    const counts = new Map<string, number>();
    for (const r of rows) counts.set((r[key] as string) || fallback, (counts.get((r[key] as string) || fallback) ?? 0) + 1);
    return [...counts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
  };

  return NextResponse.json({
    total: rows.length,
    pending: rows.filter((r) => r.escalation_status === "pending").length,
    by_category: tally("escalation_category", "uncategorized"),
    by_priority: tally("escalation_priority", "normal"),
    recent: rows
      .filter((r) => r.escalation_reason)
      .slice(0, 25)
      .map((r) => ({
        reason: r.escalation_reason,
        category: r.escalation_category ?? "uncategorized",
        priority: r.escalation_priority ?? "normal",
        escalated_at: r.escalated_at,
      })),
  });
}
