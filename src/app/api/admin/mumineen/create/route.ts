import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { canAccessPortal } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

const Body = z.object({
  its: z.string().min(1).max(20),
  full_name: z.string().min(1).max(200),
  prefix: z.string().max(50).nullable().optional(),
  is_head: z.boolean(),
  hof_its: z.string().min(1).max(20).optional(),
  gender: z.enum(["M", "F"]).nullable().optional(),
  local_mehman: z.enum(["Local", "Mehman"]).nullable().optional(),
  age: z.number().int().min(0).max(150).nullable().optional(),
  whatsapp_e164: z.string().max(20).nullable().optional(),
  email: z.string().max(200).nullable().optional(),
  jamaat: z.string().max(200).nullable().optional(),
  // For a non-head add whose family doesn't exist yet: create the family (confirmed in the UI).
  create_family: z.boolean().optional(),
});

// POST /api/admin/mumineen/create — manually add a single mumin to the roster.
// If is_head=true, creates a new families row as well.
// If is_head=false, hof_its is required and the family must already exist.
export async function POST(req: NextRequest) {
  const auth = await requirePortalCaller(req, canAccessPortal);
  if (auth instanceof NextResponse) return auth;

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
  let createdFamily = false;

  if (body.is_head) {
    const { data: existingFam } = await supabase
      .from("families")
      .select("id")
      .eq("hof_its", body.its)
      .maybeSingle();
    if (existingFam) {
      // The family already exists but its HoF wasn't in the roster (an acting head stood in).
      // Attach the now-arriving HoF mumin to that existing family instead of rejecting.
      familyId = existingFam.id;
    } else {
      const { data: newFam, error: famErr } = await supabase
        .from("families")
        .insert({ hof_its: body.its, roster_active: true, registration_status: "not_started" })
        .select("id")
        .single();
      if (famErr || !newFam) {
        return NextResponse.json({ error: famErr?.message ?? "Failed to create family row" }, { status: 500 });
      }
      familyId = newFam.id;
      createdFamily = true;
    }
  } else {
    const { data: fam } = await supabase
      .from("families")
      .select("id")
      .eq("hof_its", hofIts)
      .eq("roster_active", true)
      .maybeSingle();
    if (fam) {
      familyId = fam.id;
    } else if (body.create_family) {
      // No family yet for this HoF ITS (the head isn't in the roster). Create it — this member is
      // the computed acting head until the head, or an older member, is added.
      const { data: newFam, error: famErr } = await supabase
        .from("families")
        .insert({ hof_its: hofIts, roster_active: true, registration_status: "not_started" })
        .select("id")
        .single();
      if (famErr || !newFam) {
        return NextResponse.json({ error: famErr?.message ?? "Failed to create family row" }, { status: 500 });
      }
      familyId = newFam.id;
      createdFamily = true;
    } else {
      // Signal the UI so it can offer to create the family (confirm-on-submit).
      return NextResponse.json(
        { error: `No family found for HoF ITS ${hofIts}.`, code: "family_missing" },
        { status: 404 },
      );
    }
  }

  const { data: newMumin, error: muminErr } = await supabase
    .from("mumineen")
    .insert({
      its: body.its,
      hof_its: hofIts,
      family_id: familyId,
      is_head: body.is_head,
      full_name: body.full_name,
      prefix: body.prefix ?? null,
      gender: body.gender ?? null,
      local_mehman: body.local_mehman ?? null,
      age: body.age ?? null,
      // is_adult is a GENERATED column (age >= 18) — Postgres computes it; never insert it.
      whatsapp_e164: body.whatsapp_e164 ?? null,
      email: body.email ?? null,
      jamaat: body.jamaat ?? null,
      roster_active: true,
    })
    .select()
    .single();

  if (muminErr || !newMumin) {
    // Only roll back a family row we created here — never an existing one we attached to.
    // Key on hofIts: that's the created family's hof_its for both the head and non-head paths.
    if (createdFamily) {
      await supabase.from("families").delete().eq("hof_its", hofIts);
    }
    return NextResponse.json({ error: muminErr?.message ?? "Failed to create mumin record" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, member: newMumin }, { status: 201 });
}
