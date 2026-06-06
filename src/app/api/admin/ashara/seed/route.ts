import { NextRequest, NextResponse } from "next/server";

import { requireAdminKey } from "@/lib/api/auth";
import { DEFAULT_ACTIVE_YEAR } from "@/lib/knowledge/ashara-config";
import { seedMajlisDay } from "@/lib/knowledge/seed-majlis";

export const runtime = "nodejs";
export const maxDuration = 120;

// POST { year, majlis_number, is_ashura }: create the 6 per-category slots for one majlis.
// Backs the dashboard's "Seed this majlis" button. Idempotent.
export async function POST(req: NextRequest) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const year = typeof body.year === "string" && body.year.trim() ? body.year.trim() : DEFAULT_ACTIVE_YEAR;
  const isAshura = body.is_ashura === true;
  const majlisNumber =
    typeof body.majlis_number === "number" && body.majlis_number >= 1 && body.majlis_number <= 8
      ? body.majlis_number
      : null;

  if (!isAshura && majlisNumber == null) {
    return NextResponse.json({ error: "majlis_number (1–8) or is_ashura is required" }, { status: 400 });
  }

  try {
    const stats = await seedMajlisDay(year, { majlisNumber, isAshura });
    return NextResponse.json({ ok: true, stats });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to seed" }, { status: 500 });
  }
}
