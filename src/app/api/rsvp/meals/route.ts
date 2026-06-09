import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { resolveFamilyForPhone } from "@/lib/rsvp/family";
import { getFamilyNiyazGrid, setFamilyNiyazRsvp } from "@/lib/rsvp/meal-rsvp";

export const runtime = "nodejs";

// Niyaz RSVP for the caller's own family. Identified (and authorized) by x-whatsapp-from: a caller
// can only read/write their own family's grid. Used by the agent's get/set meal-RSVP tools.
// Attendance is pre-seeded from arrival dates, so the agent mainly records changes (e.g. "we're not
// coming on the 16th"). A change cascades to the whole family for the matched event(s).

const entrySchema = z.object({
  attending: z.boolean(),
  dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  meal: z.enum(["lunch", "dinner"]).optional(),
  all: z.boolean().optional(),
});

const postSchema = z.object({ entries: z.array(entrySchema).min(1).max(60) });

function requirePhone(req: NextRequest): string | null {
  const phone = req.headers.get("x-whatsapp-from");
  return phone && phone.trim() ? phone.trim() : null;
}

// GET — the caller's family Niyaz grid (every event + how many of the family are attending).
export async function GET(req: NextRequest) {
  const phone = requirePhone(req);
  if (!phone) return NextResponse.json({ error: "Missing x-whatsapp-from header" }, { status: 400 });

  const family = await resolveFamilyForPhone(phone);
  if (!family) {
    return NextResponse.json({ status: "no_family", grid: [], message: "This number isn't linked to a registered family." });
  }

  const grid = await getFamilyNiyazGrid(family.familyId);
  return NextResponse.json({ status: "ok", grid });
}

// POST — set RSVP for the caller's family across one or more days/meals.
export async function POST(req: NextRequest) {
  const phone = requirePhone(req);
  if (!phone) return NextResponse.json({ error: "Missing x-whatsapp-from header" }, { status: 400 });

  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  }

  const family = await resolveFamilyForPhone(phone);
  if (!family) {
    return NextResponse.json({ status: "no_family", message: "This number isn't linked to a registered family." }, { status: 200 });
  }

  const result = await setFamilyNiyazRsvp(
    family.familyId,
    parsed.data.entries.map((e) => ({ attending: e.attending, dates: e.dates, meal: e.meal, all: e.all })),
    { source: "whatsapp", phone },
  );

  return NextResponse.json({ status: "ok", updated: result.updated, grid: result.grid });
}
