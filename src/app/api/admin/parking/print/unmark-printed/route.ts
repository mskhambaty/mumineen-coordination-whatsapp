import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { canManageParking } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

const BodySchema = z.object({
  pass_ids: z.array(z.string().uuid()).min(1).max(2000),
});

// POST /api/admin/parking/print/unmark-printed
// Clears printed_at (sets to null) on the given pass IDs — requires canManageParking.
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

  const BATCH = 100;
  let total = 0;
  for (let i = 0; i < pass_ids.length; i += BATCH) {
    const chunk = pass_ids.slice(i, i + BATCH);
    const { error, count } = await supabase
      .from("parking_passes")
      .update({ printed_at: null }, { count: "exact" })
      .in("id", chunk)
      .not("printed_at", "is", null);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    total += count ?? 0;
  }

  return NextResponse.json({ ok: true, unmarked: total });
}
