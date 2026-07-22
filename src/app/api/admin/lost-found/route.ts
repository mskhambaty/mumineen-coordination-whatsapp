import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { canAccessPortal } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// GET /api/admin/lost-found — list all reports (open + resolved) with resolver info
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, canAccessPortal);
  if (auth instanceof NextResponse) return auth;

  const { data, error } = await getSupabaseAdmin()
    .from("lost_found_reports")
    .select("id, report_type, status, item_name, description, category, color, brand, location, occurred_at, reporter_name, reporter_phone_e164, reporter_its, escalation_status, escalated_at, resolved_by_name, resolved_at, resolved_notes, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "Could not load lost-and-found reports" }, { status: 500 });
  }
  return NextResponse.json({ reports: data ?? [] });
}

// ---------------------------------------------------------------------------
// POST /api/admin/lost-found — manually add a lost/found item from the portal
// ---------------------------------------------------------------------------
const createSchema = z.object({
  report_type: z.enum(["lost", "found"]),
  item_name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(2000).nullish(),
  category: z.string().trim().max(120).nullish(),
  color: z.string().trim().max(120).nullish(),
  brand: z.string().trim().max(120).nullish(),
  location: z.string().trim().max(500).nullish(),
  occurred_at: z.string().datetime({ offset: true }).nullish(),
  reporter_name: z.string().trim().max(200).nullish(),
  reporter_its: z.string().trim().max(40).nullish(),
}).strict();

export async function POST(req: NextRequest) {
  const auth = await requirePortalCaller(req, canAccessPortal);
  if (auth instanceof NextResponse) return auth;

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  }

  const caller = auth.caller;
  const supabase = getSupabaseAdmin();

  const { data: department } = await supabase
    .from("departments")
    .select("id")
    .ilike("name", "%Lost%Found%")
    .limit(1)
    .maybeSingle();

  const { data: report, error } = await supabase
    .from("lost_found_reports")
    .insert({
      report_type: parsed.data.report_type,
      item_name: parsed.data.item_name,
      description: parsed.data.description || null,
      category: parsed.data.category || null,
      color: parsed.data.color || null,
      brand: parsed.data.brand || null,
      location: parsed.data.location || null,
      occurred_at: parsed.data.occurred_at || null,
      department_id: department?.id ?? null,
      reporter_name: parsed.data.reporter_name || caller.display_name || "Portal User",
      reporter_phone_e164: "portal",
      reporter_its: parsed.data.reporter_its || null,
      source: "manual",
      escalation_status: "not_required",
    })
    .select("id, report_type, created_at")
    .single();

  if (error || !report) {
    return NextResponse.json({ error: "Could not create report" }, { status: 500 });
  }
  return NextResponse.json({ report }, { status: 201 });
}
