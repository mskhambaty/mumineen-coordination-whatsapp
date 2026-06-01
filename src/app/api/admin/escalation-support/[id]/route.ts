import { NextRequest, NextResponse } from "next/server";

import { requireAdminKey } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

type HourInput = { day_of_week?: unknown; start_time?: unknown; end_time?: unknown };

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// DELETE: remove a support member (cascades their on-call hours).
export async function DELETE(req: NextRequest, { params }: RouteContext) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const { error } = await getSupabaseAdmin()
    .from("escalation_support_members")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

// PUT: replace a member's on-call hours with the provided weekly ranges.
export async function PUT(req: NextRequest, { params }: RouteContext) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { hours?: unknown };
  const rawHours = Array.isArray(body.hours) ? (body.hours as HourInput[]) : [];

  const rows: { member_id: string; day_of_week: number; start_time: string; end_time: string }[] = [];
  for (const h of rawHours) {
    const day = Number(h.day_of_week);
    // Postgres returns time as "HH:MM:SS"; the time picker sends "HH:MM". Normalize to HH:MM.
    const start = typeof h.start_time === "string" ? h.start_time.slice(0, 5) : "";
    const end = typeof h.end_time === "string" ? h.end_time.slice(0, 5) : "";
    if (!Number.isInteger(day) || day < 0 || day > 6) {
      return NextResponse.json({ error: "day_of_week must be 0-6" }, { status: 400 });
    }
    if (!TIME_RE.test(start) || !TIME_RE.test(end)) {
      return NextResponse.json({ error: "start_time and end_time must be HH:MM" }, { status: 400 });
    }
    if (end === start) {
      return NextResponse.json({ error: "Start and end time can't be the same." }, { status: 400 });
    }
    // Note: end < start is allowed — it means an overnight range (e.g. 9 PM–6 AM).
    rows.push({ member_id: id, day_of_week: day, start_time: start, end_time: end });
  }

  const supabase = getSupabaseAdmin();

  // Confirm the member exists so we don't silently no-op on a bad id.
  const { data: member } = await supabase
    .from("escalation_support_members")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (!member) {
    return NextResponse.json({ error: "Support member not found" }, { status: 404 });
  }

  const { error: deleteError } = await supabase
    .from("escalation_oncall_hours")
    .delete()
    .eq("member_id", id);
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  if (rows.length > 0) {
    const { error: insertError } = await supabase.from("escalation_oncall_hours").insert(rows);
    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, count: rows.length });
}
