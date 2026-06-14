import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { canAccessPortal } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const resolveSchema = z.object({
  notes: z.string().trim().max(2000).optional(),
}).strict();

// ---------------------------------------------------------------------------
// PATCH /api/admin/lost-found/[id]/resolve — mark item as resolved (found/returned)
// Records which portal user closed it and when.
// ---------------------------------------------------------------------------
export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const auth = await requirePortalCaller(req, canAccessPortal);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const parsed = resolveSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  }

  const caller = auth.caller;
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("lost_found_reports")
    .update({
      status: "resolved",
      resolved_by: caller.user_id !== "admin-api" ? caller.user_id : null,
      resolved_by_name: caller.display_name ?? "Portal User",
      resolved_at: new Date().toISOString(),
      resolved_notes: parsed.data.notes || null,
    })
    .eq("id", id)
    .eq("status", "open")
    .select("id")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Report not found or already resolved" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
