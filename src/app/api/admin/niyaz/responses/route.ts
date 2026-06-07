import { NextRequest, NextResponse } from "next/server";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { num, oneOf, str } from "@/lib/registration/normalize";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { requirePortalCaller } from "@/lib/api/portal-auth";

export const runtime = "nodejs";

const RESPONSES = ["yes", "no", "maybe"] as const;

type ResponseBody = {
  registration_instance_id?: unknown;
  hof_its?: unknown; // family is resolved by HOF ITS for admin entry
  submitted_by_its?: unknown; // optional: which member this is recorded for
  response?: unknown;
  head_count?: unknown;
  recorded_by?: unknown; // signed-in admin (its/email)
};

// POST /api/admin/niyaz/responses — admin records a per-family RSVP for a Niyaz instance.
// One admin row per (instance, family): if one exists already, this updates it (a new
// submission timestamp) rather than appending a duplicate.
export async function POST(req: NextRequest) {
  const auth = await requirePortalCaller(req, isAdminOrLeadership);
  if (auth instanceof NextResponse) return auth;
  const body = (await req.json().catch(() => ({}))) as ResponseBody;

  const instanceId = str(body.registration_instance_id);
  const hofIts = str(body.hof_its);
  if (!instanceId) return NextResponse.json({ error: "Missing Niyaz instance." }, { status: 400 });
  if (!hofIts) return NextResponse.json({ error: "Enter the family's HOF ITS." }, { status: 400 });

  const response = oneOf(body.response, RESPONSES);
  if (!response) return NextResponse.json({ error: "Response must be yes, no, or maybe." }, { status: 400 });
  const headCount = num(body.head_count);
  if (headCount !== null && headCount < 0) {
    return NextResponse.json({ error: "Head count cannot be negative." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  // Niyaz instance must exist.
  const { data: instance } = await supabase.from("rsvp_registration_instance").select("id").eq("id", instanceId).maybeSingle();
  if (!instance) return NextResponse.json({ error: "Niyaz instance not found." }, { status: 404 });

  // Resolve the family by HOF ITS.
  const { data: family } = await supabase.from("families").select("id").eq("hof_its", hofIts).eq("roster_active", true).maybeSingle();
  if (!family) return NextResponse.json({ error: `No family found for HOF ITS ${hofIts}.` }, { status: 404 });

  // Optional: resolve the member this is recorded for (must belong to the family).
  let submittedByMuminId: string | null = null;
  const submittedByIts = str(body.submitted_by_its);
  if (submittedByIts) {
    const { data: mumin } = await supabase
      .from("mumineen")
      .select("id")
      .eq("its", submittedByIts)
      .eq("hof_its", hofIts)
      .eq("roster_active", true)
      .maybeSingle();
    if (!mumin) return NextResponse.json({ error: `ITS ${submittedByIts} is not a member of this family.` }, { status: 400 });
    submittedByMuminId = mumin.id;
  }

  const now = new Date().toISOString();
  const fields = {
    response,
    head_count: response === "yes" ? headCount : 0,
    submitted_by_mumin_id: submittedByMuminId,
    source: "admin" as const,
    recorded_by: str(body.recorded_by),
    submitted_at: now,
  };

  // Update this instance's existing admin row for the family if present; else insert one.
  const { data: existing } = await supabase
    .from("rsvp_responses")
    .select("id")
    .eq("registration_instance_id", instanceId)
    .eq("family_id", family.id)
    .eq("source", "admin")
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    const { data, error } = await supabase
      .from("rsvp_responses")
      .update(fields)
      .eq("id", existing.id)
      .select("id")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, id: data.id, updated: true });
  }

  const { data, error } = await supabase
    .from("rsvp_responses")
    .insert({ registration_instance_id: instanceId, family_id: family.id, ...fields })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, id: data.id, updated: false }, { status: 201 });
}
