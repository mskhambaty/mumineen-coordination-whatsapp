import { NextRequest, NextResponse } from "next/server";

import { canViewParking } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

type FamilyRow = { id: string; hof_its: string };
type MemberRow = { hof_its: string; full_name: string | null; whatsapp_e164: string | null; is_head: boolean };

// GET /api/admin/parking/print?lot_id=<id>
// Returns lot details + every pass in that lot with the family head's name and phone.
// Used exclusively by the print page — no pagination needed (pass counts are small).
export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, canViewParking);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(req.url);
  const lotId = searchParams.get("lot_id");
  if (!lotId) {
    return NextResponse.json({ error: "Missing lot_id." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  const [{ data: lot, error: lotErr }, { data: rawPasses, error: passErr }] = await Promise.all([
    supabase.from("parking_lots").select("id, name, color").eq("id", lotId).maybeSingle(),
    supabase.from("parking_passes").select("id, family_id").eq("lot_id", lotId).order("created_at"),
  ]);

  if (lotErr) return NextResponse.json({ error: lotErr.message }, { status: 500 });
  if (!lot) return NextResponse.json({ error: "Lot not found." }, { status: 404 });
  if (passErr) return NextResponse.json({ error: passErr.message }, { status: 500 });

  const passes = rawPasses ?? [];
  if (passes.length === 0) {
    return NextResponse.json({ lot, passes: [] });
  }

  const familyIds = [...new Set(passes.map((p) => p.family_id))];

  const [{ data: families, error: famErr }] = await Promise.all([
    supabase.from("families").select("id, hof_its").in("id", familyIds),
  ]);
  if (famErr) return NextResponse.json({ error: famErr.message }, { status: 500 });

  const hofItsByFamily = new Map((families ?? []).map((f: FamilyRow) => [f.id, f.hof_its]));
  const hofItsValues = [...new Set(hofItsByFamily.values())];

  const { data: members, error: memErr } = await supabase
    .from("mumineen")
    .select("hof_its, full_name, whatsapp_e164, is_head")
    .in("hof_its", hofItsValues);
  if (memErr) return NextResponse.json({ error: memErr.message }, { status: 500 });

  const membersByHof = new Map<string, MemberRow[]>();
  for (const m of (members ?? []) as MemberRow[]) {
    const list = membersByHof.get(m.hof_its);
    if (list) list.push(m);
    else membersByHof.set(m.hof_its, [m]);
  }

  const result = passes
    .map((p) => {
      const hofIts = hofItsByFamily.get(p.family_id) ?? "";
      const mems = membersByHof.get(hofIts) ?? [];
      const head = mems.find((m) => m.is_head) ?? mems[0] ?? null;
      return {
        id: p.id,
        hof_its: hofIts,
        head_name: head?.full_name ?? hofIts,
        phone: head?.whatsapp_e164 ?? mems.find((m) => m.whatsapp_e164)?.whatsapp_e164 ?? null,
      };
    })
    .sort((a, b) => a.head_name.localeCompare(b.head_name));

  return NextResponse.json({ lot, passes: result });
}
