import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

const Body = z.object({
  its: z.string().min(1).max(20).regex(/^\d+$/, "ITS must be numeric"),
});

// POST /api/webinars/verify-its — public endpoint.
// Validates an ITS number against the active roster and returns the member's
// first name for a greeting. Returns no other PII.
export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => null);
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid ITS number" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("mumineen")
    .select("full_name")
    .eq("its", parsed.data.its)
    .eq("roster_active", true)
    .maybeSingle();

  if (!data) {
    return NextResponse.json({ ok: false, error: "ITS number not found in the active roster" });
  }

  const firstName = data.full_name?.split(" ")[0] ?? null;
  return NextResponse.json({ ok: true, name: firstName });
}
