import { NextRequest, NextResponse } from "next/server";

import { requireAdminLeadership } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

// GET /api/admin/templates/broadcasts/[id] — one broadcast plus its delivery-status rollup
// (queued/sent/failed/delivered/read/replied). Admin/leadership only. Phone numbers are NOT
// returned — only aggregate status counts.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdminLeadership(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const supabase = getSupabaseAdmin();

  const { data: broadcast } = await supabase.from("template_broadcasts").select("*").eq("id", id).maybeSingle();
  if (!broadcast) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: recips } = await supabase
    .from("template_broadcast_recipients")
    .select("send_status")
    .eq("broadcast_id", id);

  const statusCounts: Record<string, number> = {};
  for (const r of (recips ?? []) as { send_status: string }[]) {
    statusCounts[r.send_status] = (statusCounts[r.send_status] ?? 0) + 1;
  }

  return NextResponse.json({ broadcast, status_counts: statusCounts });
}
