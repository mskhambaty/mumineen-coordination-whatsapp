import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { canAccessPortal } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const updateSchema = z.object({
  item_name: z.string().trim().min(2).max(160).optional(),
  description: z.string().trim().max(2000).nullish(),
  category: z.string().trim().max(120).nullish(),
  color: z.string().trim().max(120).nullish(),
  brand: z.string().trim().max(120).nullish(),
  location: z.string().trim().max(500).nullish(),
  occurred_at: z.string().datetime({ offset: true }).nullish(),
  reporter_name: z.string().trim().max(200).nullish(),
  reporter_its: z.string().trim().max(40).nullish(),
}).strict();

// ---------------------------------------------------------------------------
// PUT /api/admin/lost-found/[id] — edit a lost/found item
// ---------------------------------------------------------------------------
export async function PUT(req: NextRequest, { params }: RouteContext) {
  const auth = await requirePortalCaller(req, canAccessPortal);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const parsed = updateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("lost_found_reports")
    .update(parsed.data)
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Report not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

// ---------------------------------------------------------------------------
// DELETE /api/admin/lost-found/[id] — remove a lost/found item
// ---------------------------------------------------------------------------
export async function DELETE(req: NextRequest, { params }: RouteContext) {
  const auth = await requirePortalCaller(req, canAccessPortal);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const supabase = getSupabaseAdmin();
  const { error, count } = await supabase
    .from("lost_found_reports")
    .delete()
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (count === 0) return NextResponse.json({ error: "Report not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
