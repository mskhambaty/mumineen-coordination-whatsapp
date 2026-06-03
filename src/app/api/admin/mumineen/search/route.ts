import { NextRequest, NextResponse } from "next/server";

import { requireAdminKey } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

// GET /api/admin/mumineen/search?q=<term> — lookup roster members by ITS, name, phone, or HOF ITS.
export async function GET(req: NextRequest) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  // Escape PostgREST or-filter metacharacters in the user term.
  const safe = q.replace(/[%,()]/g, " ");
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("mumineen")
    .select(
      "its, full_name, gender, age, jamaat, city, hof_its, is_head, whatsapp_e164, email, family:families(registration_status)",
    )
    .eq("roster_active", true)
    .or(`its.ilike.%${safe}%,full_name.ilike.%${safe}%,whatsapp_e164.ilike.%${safe}%,hof_its.ilike.%${safe}%`)
    .order("is_head", { ascending: false })
    .order("full_name", { ascending: true })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ results: data ?? [] });
}
