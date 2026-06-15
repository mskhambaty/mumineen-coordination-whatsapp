import { NextRequest, NextResponse } from "next/server";

import { resolveFamilyForPhone } from "@/lib/rsvp/family";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { PARKING_GENERAL_ACCESS, PARKING_RIDESHARE_DROPOFF, parkingEntryFor } from "@/lib/parking/entry-info";

export const runtime = "nodejs";

// Parking pass lookup for the caller's OWN family. Identified (and authorized) solely by the
// authenticated WhatsApp number in x-whatsapp-from — the caller can ONLY ever see their own
// family's passes, never anyone else's. No ITS or family is accepted from the request body, so
// there is no way to query another person's pass. Used by the agent's get_family_parking_passes
// tool. The DB has no "collected" flag, so collection status is asked of the user, not returned.

function requirePhone(req: NextRequest): string | null {
  const phone = req.headers.get("x-whatsapp-from");
  return phone && phone.trim() ? phone.trim() : null;
}

type LotRow = { id: string; name: string | null; color: string | null };

export async function GET(req: NextRequest) {
  const phone = requirePhone(req);
  if (!phone) return NextResponse.json({ error: "Missing x-whatsapp-from header" }, { status: 400 });

  const family = await resolveFamilyForPhone(phone);
  if (!family) {
    // Number isn't linked to a registered family — we can't look up a pass. The agent should ask
    // whether they need one and escalate to Transport.
    return NextResponse.json({
      status: "unregistered",
      general_access: PARKING_GENERAL_ACCESS,
      rideshare_dropoff: PARKING_RIDESHARE_DROPOFF,
      message:
        "This number isn't linked to a registered family, so no parking pass can be looked up. Ask whether they need a parking pass; if so, escalate to the Transport team.",
    });
  }

  const supabase = getSupabaseAdmin();

  const { data: passRows, error: passError } = await supabase
    .from("parking_passes")
    .select("id, printed_at, lot_id")
    .eq("family_id", family.familyId);

  if (passError) {
    return NextResponse.json({ error: "Could not look up parking passes." }, { status: 500 });
  }

  const passes = passRows ?? [];
  const lotIds = Array.from(new Set(passes.map((p) => p.lot_id).filter((id): id is string => Boolean(id))));

  const lotById = new Map<string, LotRow>();
  if (lotIds.length > 0) {
    const { data: lots, error: lotError } = await supabase
      .from("parking_lots")
      .select("id, name, color")
      .in("id", lotIds);
    if (lotError) {
      return NextResponse.json({ error: "Could not look up parking passes." }, { status: 500 });
    }
    for (const lot of (lots ?? []) as LotRow[]) lotById.set(lot.id, lot);
  }

  const detailed = passes.map((p) => {
    const lot = p.lot_id ? lotById.get(p.lot_id) ?? null : null;
    const info = parkingEntryFor(lot?.color);
    return {
      lot_name: lot?.name ?? null,
      color: lot?.color ?? null,
      purpose: info?.purpose ?? null,
      entry: info?.entry ?? null,
    };
  });

  return NextResponse.json({
    status: detailed.length > 0 ? "ok" : "no_passes",
    head_name: family.displayName,
    general_access: PARKING_GENERAL_ACCESS,
    rideshare_dropoff: PARKING_RIDESHARE_DROPOFF,
    passes: detailed,
    message:
      detailed.length > 0
        ? "Parking passes allocated to the caller's own family. Only share these with the caller — never reveal another family's passes."
        : "No parking pass is allocated to the caller's family yet. Ask whether they need one; if so, escalate to the Transport team.",
  });
}
