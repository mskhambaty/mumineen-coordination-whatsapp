import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { canViewParking } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

const QuerySchema = z.object({ hof_its: z.string().min(1) });

export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, canViewParking);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(req.url);
  const parsed = QuerySchema.safeParse({ hof_its: searchParams.get("hof_its") });
  if (!parsed.success) return NextResponse.json({ error: "Missing hof_its" }, { status: 400 });
  const { hof_its } = parsed.data;

  const supabase = getSupabaseAdmin();

  const { data: family, error: famErr } = await supabase
    .from("families")
    .select(
      "id, hof_its, registration_status, submitted_at, acc_type, hotel_name, hotel_address, " +
      "utaro_host_name, utaro_host_its, utaro_host_address, transport_mode, transport_detail, open_to_utaro",
    )
    .eq("hof_its", hof_its)
    .single();

  if (famErr || !family) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const familyId = (family as unknown as { id: string }).id;

  const [membersRes, passesRes, lotsRes, guestFamiliesRes] = await Promise.all([
    supabase
      .from("mumineen")
      .select(
        "its, full_name, gender, age, is_head, is_adult, local_mehman, city, jamaat, " +
        "category, prefix, title, venue, rahat_seating, wheelchair, special_needs, " +
        "not_attending, whatsapp_e164, email, daily_trans, " +
        "arrival_at, arrival_flight_no, departure_at, departure_flight_no",
      )
      .eq("hof_its", hof_its)
      .order("is_head", { ascending: false })
      .order("age", { ascending: false }),
    supabase
      .from("parking_passes")
      .select("id, lot_id, notes, printed_at")
      .eq("family_id", familyId)
      .order("created_at"),
    supabase.from("parking_lots").select("id, name, color"),
    supabase
      .from("families")
      .select("hof_its, transport_mode, roster_active")
      .eq("utaro_host_its", hof_its)
      .eq("roster_active", true),
  ]);

  const lotById = new Map((lotsRes.data ?? []).map((l) => [l.id, l]));

  const passes = (passesRes.data ?? []).map((p) => {
    const lot = lotById.get(p.lot_id);
    return { id: p.id, lot_name: lot?.name ?? "Unknown", lot_color: lot?.color ?? null, notes: p.notes, printed_at: p.printed_at };
  });

  // For each utaro guest family, fetch attending count + head name.
  const guestHofItsList = (guestFamiliesRes.data ?? []).map((g) => g.hof_its);
  let guestMemberRows: { hof_its: string; full_name: string | null; is_head: boolean; not_attending: boolean | null }[] = [];
  if (guestHofItsList.length > 0) {
    const { data } = await supabase
      .from("mumineen")
      .select("hof_its, full_name, is_head, not_attending")
      .in("hof_its", guestHofItsList);
    guestMemberRows = data ?? [];
  }

  const membersByGuestHof = new Map<string, typeof guestMemberRows>();
  for (const m of guestMemberRows) {
    const list = membersByGuestHof.get(m.hof_its);
    if (list) list.push(m);
    else membersByGuestHof.set(m.hof_its, [m]);
  }

  const utaro_guests = (guestFamiliesRes.data ?? []).map((g) => {
    const mems = membersByGuestHof.get(g.hof_its) ?? [];
    const head = mems.find((m) => m.is_head) ?? mems[0];
    return {
      hof_its: g.hof_its,
      head_name: head?.full_name ?? null,
      transport_mode: g.transport_mode,
      attending_count: mems.filter((m) => !m.not_attending).length,
    };
  });

  return NextResponse.json({
    family,
    members: membersRes.data ?? [],
    passes,
    utaro_guests,
  });
}
