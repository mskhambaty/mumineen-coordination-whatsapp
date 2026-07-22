import { NextRequest, NextResponse } from "next/server";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

// GET /api/admin/surveys/mumin?its= — personal + registration details for one mumin, shown in the
// "view details" popup off a sampled record. Admin/leadership only (roster PII).
export async function GET(req: NextRequest) {
  const guard = await requirePortalCaller(req, isAdminOrLeadership);
  if (guard instanceof NextResponse) return guard;
  const its = new URL(req.url).searchParams.get("its")?.trim();
  if (!its) return NextResponse.json({ error: "Provide its=." }, { status: 400 });
  const supabase = getSupabaseAdmin();

  const { data: mumin } = await supabase
    .from("mumineen")
    .select("id, its, hof_its, full_name, gender, age, is_head, jamaat, idara, category, city, local_mehman, whatsapp_e164, email, arrival_at, departure_at, airport, rahat_seating, wheelchair, special_needs, not_attending, wants_khidmat, family_id")
    .eq("its", its)
    .eq("roster_active", true)
    .maybeSingle();
  if (!mumin) return NextResponse.json({ error: `ITS ${its} not found in the active roster.` }, { status: 404 });
  const m = mumin as Record<string, unknown> & { family_id: string | null };

  let family: Record<string, unknown> | null = null;
  if (m.family_id) {
    const { data: fam } = await supabase
      .from("families")
      .select("registration_status, acc_type, hotel_name, utaro_host_name, transport_mode")
      .eq("id", m.family_id)
      .maybeSingle();
    family = (fam as Record<string, unknown> | null) ?? null;
  }

  return NextResponse.json({
    mumin: {
      name: m.full_name, its: m.its, hof_its: m.hof_its, is_head: m.is_head,
      gender: m.gender, age: m.age, jamaat: m.jamaat, city: m.city, idara: m.idara,
      category: m.category, local_mehman: m.local_mehman, phone: m.whatsapp_e164, email: m.email,
      arrival_at: m.arrival_at, departure_at: m.departure_at, airport: m.airport,
      rahat_seating: m.rahat_seating, wheelchair: m.wheelchair, special_needs: m.special_needs,
      not_attending: m.not_attending, wants_khidmat: m.wants_khidmat,
    },
    family,
  });
}
