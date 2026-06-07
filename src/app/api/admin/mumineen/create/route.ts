import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminKey } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

const Body = z.object({
  its: z.string().min(1).max(20),
  full_name: z.string().min(1).max(200),
  is_head: z.boolean(),
  hof_its: z.string().min(1).max(20).optional(),
  gender: z.enum(["M", "F"]).nullable().optional(),
  local_mehman: z.enum(["Local", "Mehman"]).nullable().optional(),
  age: z.number().int().min(0).max(150).nullable().optional(),
  is_adult: z.boolean().nullable().optional(),
  whatsapp_e164: z.string().max(20).nullable().optional(),
  email: z.string().max(200).nullable().optional(),
  jamaat: z.string().max(200).nullable().optional(),
});

// POST /api/admin/mumineen/create — manually add a single mumin to the roster.
// If is_head=true, creates a new families row as well.
// If is_head=false, hof_its is required and the family must already exist.
export async function POST(req: NextRequest) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const body = parsed.data;
  const hofIts = body.is_head ? body.its : (body.hof_its ?? "");
  if (!hofIts) {
    return NextResponse.json({ error: "hof_its is required when is_head is false" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  const { data: existing } = await supabase
    .from("mumineen")
    .select("its")
    .eq("its", body.its)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ error: `ITS ${body.its} already exists in the roster.` }, { status: 409 });
  }

  let familyId: string;

  if (body.is_head) {
    const { data: existingFam } = await supabase
      .from("families")
      .select("id")
      .eq("hof_its", body.its)
      .maybeSingle();
    if (existingFam) {
      return NextResponse.json({ error: `A family row already exists for HoF ITS ${body.its}.` }, { status: 409 });
    }

    const { data: newFam, error: famErr } = await supabase
      .from("families")
      .insert({ hof_its: body.its, head_in_roster: true, roster_active: true, registration_status: "not_started" })
      .select("id")
      .single();
    if (famErr || !newFam) {
      return NextResponse.json({ error: famErr?.message ?? "Failed to create family row" }, { status: 500 });
    }
    familyId = newFam.id;
  } else {
    const { data: fam } = await supabase
      .from("families")
      .select("id")
      .eq("hof_its", hofIts)
      .eq("roster_active", true)
      .maybeSingle();
    if (!fam) {
      return NextResponse.json(
        { error: `No family found for HoF ITS ${hofIts}. Add the head of family first.` },
        { status: 404 },
      );
    }
    familyId = fam.id;
  }

  const { data: newMumin, error: muminErr } = await supabase
    .from("mumineen")
    .insert({
      its: body.its,
      hof_its: hofIts,
      family_id: familyId,
      is_head: body.is_head,
      full_name: body.full_name,
      gender: body.gender ?? null,
      local_mehman: body.local_mehman ?? null,
      age: body.age ?? null,
      is_adult: body.is_adult ?? null,
      whatsapp_e164: body.whatsapp_e164 ?? null,
      email: body.email ?? null,
      jamaat: body.jamaat ?? null,
      roster_active: true,
    })
    .select()
    .single();

  if (muminErr || !newMumin) {
    if (body.is_head) {
      await supabase.from("families").delete().eq("hof_its", body.its);
    }
    return NextResponse.json({ error: muminErr?.message ?? "Failed to create mumin record" }, { status: 500 });
  }

  if (body.is_head) {
    await supabase.from("families").update({ head_mumin_id: newMumin.id }).eq("hof_its", body.its);
  }

  return NextResponse.json({ ok: true, member: newMumin }, { status: 201 });
}
