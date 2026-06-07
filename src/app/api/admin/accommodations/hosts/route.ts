import { NextRequest, NextResponse } from "next/server";

import { importAccommodationHosts } from "@/lib/accommodations/import";
import { buildHostRollups } from "@/lib/accommodations/rollups";
import { requireAdminKey } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * GET /api/admin/accommodations/hosts — List host rollups.
 * POST /api/admin/accommodations/hosts — Upload host spreadsheet.
 */
export async function GET(req: NextRequest) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const hosts = await buildHostRollups();
    return NextResponse.json({ hosts });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await importAccommodationHosts(buffer, file.name);

    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

/**
 * PATCH /api/admin/accommodations/hosts — Update host include_family_friends flag.
 */
export async function PATCH(req: NextRequest) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { hostId, include_family_friends } = body as { hostId: string; include_family_friends: boolean };

    if (!hostId || typeof include_family_friends !== "boolean") {
      return NextResponse.json({ error: "hostId and include_family_friends required" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("accommodation_hosts")
      .update({ include_family_friends, updated_at: new Date().toISOString() })
      .eq("id", hostId);

    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
