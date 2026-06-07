import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { resolveFamilyForPhone } from "@/lib/rsvp/family";
import { applyMealRsvps, getFamilyMealGrid } from "@/lib/rsvp/meal-rsvp";

export const runtime = "nodejs";

// Meal RSVP for the caller's own family. Identified (and authorized) by x-whatsapp-from: a caller
// can only read/write their own family's grid. Used by the agent's get/set meal-RSVP tools.

const entrySchema = z.object({
  meal: z.enum(["lunch", "dinner"]),
  attending: z.boolean(),
  head_count: z.number().int().min(0).max(99).nullish(),
  dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  all: z.boolean().optional(),
});

const postSchema = z.object({ entries: z.array(entrySchema).min(1).max(60) });

function requirePhone(req: NextRequest): string | null {
  const phone = req.headers.get("x-whatsapp-from");
  return phone && phone.trim() ? phone.trim() : null;
}

// GET — the caller's family meal grid (all slots + their latest answer).
export async function GET(req: NextRequest) {
  const phone = requirePhone(req);
  if (!phone) return NextResponse.json({ error: "Missing x-whatsapp-from header" }, { status: 400 });

  const family = await resolveFamilyForPhone(phone);
  if (!family) {
    return NextResponse.json({ status: "no_family", grid: [], message: "This number isn't linked to a registered family." });
  }

  const grid = await getFamilyMealGrid(family.familyId);
  return NextResponse.json({ status: "ok", grid });
}

// POST — set RSVP for the caller's family across one or more meals/days.
export async function POST(req: NextRequest) {
  const phone = requirePhone(req);
  if (!phone) return NextResponse.json({ error: "Missing x-whatsapp-from header" }, { status: 400 });

  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  }

  const result = await applyMealRsvps(
    phone,
    parsed.data.entries.map((e) => ({
      meal: e.meal,
      attending: e.attending,
      headCount: e.head_count ?? null,
      dates: e.dates,
      all: e.all,
    })),
    { source: "whatsapp" },
  );

  if ("error" in result) {
    if (result.error === "no_family_for_phone") {
      return NextResponse.json({ status: "no_family", message: "This number isn't linked to a registered family." }, { status: 200 });
    }
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ status: "ok", updated: result.updated, grid: result.grid });
}
