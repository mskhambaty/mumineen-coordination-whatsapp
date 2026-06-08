import { NextRequest, NextResponse } from "next/server";

import { canAccessPortal } from "@/lib/admin/access";
import { num, oneOf } from "@/lib/registration/normalize";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { requirePortalCaller } from "@/lib/api/portal-auth";

export const runtime = "nodejs";

const RESPONSES = ["yes", "no", "maybe"] as const;

type ResponsePatch = { response?: unknown; head_count?: unknown };

// PATCH /api/admin/niyaz/responses/[id] — correct a single response row (bumps submitted_at so
// it counts as the latest submission for that family).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePortalCaller(req, canAccessPortal);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as ResponsePatch;

  const patch: Record<string, unknown> = { submitted_at: new Date().toISOString() };
  if (body.response !== undefined) {
    const response = oneOf(body.response, RESPONSES);
    if (!response) return NextResponse.json({ error: "Response must be yes, no, or maybe." }, { status: 400 });
    patch.response = response;
    if (response !== "yes") patch.head_count = 0;
  }
  if (body.head_count !== undefined) {
    const headCount = num(body.head_count);
    if (headCount !== null && headCount < 0) {
      return NextResponse.json({ error: "Head count cannot be negative." }, { status: 400 });
    }
    patch.head_count = headCount;
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("rsvp_responses").update(patch).eq("id", id).select("id").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Response not found." }, { status: 404 });
  return NextResponse.json({ ok: true, id: data.id });
}

// DELETE /api/admin/niyaz/responses/[id] — remove a single response row.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePortalCaller(req, canAccessPortal);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("rsvp_responses").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
