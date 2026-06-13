import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { canManageParking } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

const BodySchema = z.object({
  pass_ids: z.array(z.string().uuid()).min(1).max(2000),
});

// POST /api/admin/parking/print/mark-printed
// Stamps printed_at = now() on the given pass IDs.
// Only marks passes that are currently unprinted (printed_at IS NULL) to avoid
// accidentally overwriting the original print timestamp on re-prints.
export async function POST(req: NextRequest) {
  const auth = await requirePortalCaller(req, canManageParking);
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { pass_ids } = parsed.data;
  const supabase = getSupabaseAdmin();

  const { error, count } = await supabase
    .from("parking_passes")
    .update({ printed_at: new Date().toISOString() })
    .in("id", pass_ids)
    .is("printed_at", null)
    .select("id", { count: "exact", head: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, marked: count ?? 0 });
}
