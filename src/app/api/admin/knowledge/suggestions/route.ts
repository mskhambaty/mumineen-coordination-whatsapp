import { NextRequest, NextResponse } from "next/server";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { requirePortalCaller } from "@/lib/api/portal-auth";

export const runtime = "nodejs";

// GET: list learned-from-conversation suggestions (pending by default).
export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, isAdminOrLeadership);
  if (auth instanceof NextResponse) return auth;

  const status = req.nextUrl.searchParams.get("status") ?? "pending";

  const { data, error } = await getSupabaseAdmin()
    .from("knowledge_suggestions")
    .select("id, question, suggested_answer, category, source_phone, confidence, status, created_at, department_id, department:departments(name)")
    .eq("status", status)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ suggestions: data ?? [] });
}
