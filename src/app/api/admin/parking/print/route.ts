import { NextRequest, NextResponse } from "next/server";

import { canViewParking } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

type FamilyRow = { id: string; hof_its: string };
type MemberRow = { hof_its: string; full_name: string | null; whatsapp_e164: string | null; is_head: boolean };
type LotRow = { id: string; name: string; color: string | null };

// GET /api/admin/parking/print
// ?lot_id=<id>        — passes for one lot, sorted alphabetically by name.
// ?hof_its=<its>      — passes for one household, sorted by lot name.
// (neither)           — ALL passes across every lot, sorted by ITS number.
// ?unprinted_only=1   — only passes where printed_at IS NULL (default: 1).
// ?unprinted_only=0   — all passes regardless of print status.
// Response includes total_passes (pre-filter) and unprinted_count for the toolbar.
export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, canViewParking);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(req.url);
  const lotId = searchParams.get("lot_id");
  const hofIts = searchParams.get("hof_its");
  const unprintedOnly = searchParams.get("unprinted_only") !== "0"; // default true

  const supabase = getSupabaseAdmin();

  // For a household view, resolve its family ids up front so we can scope the pass query.
  let householdFamilyIds: string[] | null = null;
  if (hofIts) {
    const { data: hofFamilies, error: hofErr } = await supabase
      .from("families")
      .select("id")
      .eq("hof_its", hofIts);
    if (hofErr) return NextResponse.json({ error: hofErr.message }, { status: 500 });
    householdFamilyIds = (hofFamilies ?? []).map((f: { id: string }) => f.id);
    if (householdFamilyIds.length === 0) {
      return NextResponse.json({ error: "Household not found." }, { status: 404 });
    }
  }

  const passesQuery = supabase.from("parking_passes").select("id, family_id, lot_id, printed_at");
  const [lotsResult, allPassesResult] = await Promise.all([
    lotId
      ? supabase.from("parking_lots").select("id, name, color").eq("id", lotId)
      : supabase.from("parking_lots").select("id, name, color"),
    lotId
      ? passesQuery.eq("lot_id", lotId).order("created_at")
      : householdFamilyIds
        ? passesQuery.in("family_id", householdFamilyIds).order("created_at")
        : passesQuery.order("created_at"),
  ]);

  if (lotsResult.error) return NextResponse.json({ error: lotsResult.error.message }, { status: 500 });
  if (allPassesResult.error) return NextResponse.json({ error: allPassesResult.error.message }, { status: 500 });

  const lots = (lotsResult.data ?? []) as LotRow[];
  const lot = lotId ? (lots[0] ?? null) : null;
  if (lotId && !lot) return NextResponse.json({ error: "Lot not found." }, { status: 404 });

  const lotById = new Map(lots.map((l) => [l.id, l]));
  const allPasses = allPassesResult.data ?? [];
  const totalPasses = allPasses.length;
  const unprintedCount = allPasses.filter((p) => !p.printed_at).length;

  const rawPasses = unprintedOnly ? allPasses.filter((p) => !p.printed_at) : allPasses;

  if (rawPasses.length === 0) {
    return NextResponse.json({ lot, passes: [], total_passes: totalPasses, unprinted_count: unprintedCount });
  }

  const familyIds = [...new Set(rawPasses.map((p) => p.family_id))];

  const { data: families, error: famErr } = await supabase
    .from("families")
    .select("id, hof_its")
    .in("id", familyIds);
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

  const result = rawPasses
    .map((p) => {
      const hofIts = hofItsByFamily.get(p.family_id) ?? "";
      const mems = membersByHof.get(hofIts) ?? [];
      const head = mems.find((m) => m.is_head) ?? mems[0] ?? null;
      const passLot = lotById.get(p.lot_id);
      return {
        id: p.id,
        hof_its: hofIts,
        head_name: head?.full_name ?? hofIts,
        phone: head?.whatsapp_e164 ?? mems.find((m) => m.whatsapp_e164)?.whatsapp_e164 ?? null,
        lot_name: passLot?.name ?? "",
        lot_color: passLot?.color ?? null,
        printed_at: p.printed_at ?? null,
      };
    })
    .sort(lotId || hofIts
      ? (a, b) => a.lot_name.localeCompare(b.lot_name) || a.head_name.localeCompare(b.head_name)
      : (a, b) => a.hof_its.localeCompare(b.hof_its),
    );

  const household = hofIts
    ? { hof_its: hofIts, head_name: result[0]?.head_name ?? hofIts }
    : null;

  return NextResponse.json({ lot, household, passes: result, total_passes: totalPasses, unprinted_count: unprintedCount });
}
