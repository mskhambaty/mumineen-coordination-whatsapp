import { NextRequest, NextResponse } from "next/server";

import { canManageKnowledge } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

// GET /api/admin/knowledge-gaps?status=open — topics the agent couldn't answer, most-asked first.
export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, canManageKnowledge);
  if (auth instanceof NextResponse) return auth;
  const status = req.nextUrl.searchParams.get("status") ?? "open";
  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("knowledge_gaps")
    .select("id, topic, sample_question, status, times_seen, first_seen_at, last_seen_at")
    .order("times_seen", { ascending: false })
    .order("last_seen_at", { ascending: false })
    .limit(500);
  if (status !== "all") query = query.eq("status", status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ gaps: data ?? [] });
}

// PATCH /api/admin/knowledge-gaps — update a gap's status (open | addressed | dismissed).
export async function PATCH(req: NextRequest) {
  const auth = await requirePortalCaller(req, canManageKnowledge);
  if (auth instanceof NextResponse) return auth;
  const body = (await req.json().catch(() => ({}))) as { id?: unknown; status?: unknown };
  const id = typeof body.id === "string" ? body.id : "";
  const status = body.status === "open" || body.status === "addressed" || body.status === "dismissed" ? body.status : null;
  if (!id || !status) {
    return NextResponse.json({ error: "id and a valid status (open|addressed|dismissed) are required." }, { status: 400 });
  }
  const { error } = await getSupabaseAdmin()
    .from("knowledge_gaps")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, id, status });
}
