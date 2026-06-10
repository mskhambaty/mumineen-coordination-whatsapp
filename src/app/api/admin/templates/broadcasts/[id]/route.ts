import { NextRequest, NextResponse } from "next/server";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { categorizeFailure } from "@/lib/whatsapp/broadcast";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

// GET /api/admin/templates/broadcasts/[id] — one broadcast plus its delivery-status rollup
// (queued/sent/failed/delivered/read/replied) and a grouped breakdown of failure reasons. Admin/
// leadership only. Phone numbers are NOT returned here — only aggregate counts (use the /failures
// endpoint for the per-recipient list).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePortalCaller(req, isAdminOrLeadership);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const supabase = getSupabaseAdmin();

  const { data: broadcast } = await supabase.from("template_broadcasts").select("*").eq("id", id).maybeSingle();
  if (!broadcast) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: recips } = await supabase
    .from("template_broadcast_recipients")
    .select("send_status, error_detail, was_in_window")
    .eq("broadcast_id", id);

  const statusCounts: Record<string, number> = {};
  const failureReasons: Record<string, number> = {};
  for (const r of (recips ?? []) as { send_status: string; error_detail: string | null; was_in_window: boolean | null }[]) {
    statusCounts[r.send_status] = (statusCounts[r.send_status] ?? 0) + 1;
    if (r.send_status === "failed") {
      const reason = categorizeFailure(r.error_detail, r.was_in_window);
      failureReasons[reason] = (failureReasons[reason] ?? 0) + 1;
    }
  }

  return NextResponse.json({ broadcast, status_counts: statusCounts, failure_reasons: failureReasons });
}
