import { NextRequest, NextResponse } from "next/server";

import { geocodeAddress, importAccommodationHosts } from "@/lib/accommodations/import";
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
 * PATCH /api/admin/accommodations/hosts — Update host settings or trigger geocoding.
 * Body: { hostId, include_family_friends } OR { hostId, action: "geocode" }
 */
export async function PATCH(req: NextRequest) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { hostId, action, include_family_friends } = body as {
      hostId: string;
      action?: string;
      include_family_friends?: boolean;
    };

    if (!hostId) {
      return NextResponse.json({ error: "hostId required" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // Geocode a single host
    if (action === "geocode") {
      const { data: host, error: hostErr } = await supabase
        .from("accommodation_hosts")
        .select("id, address, city")
        .eq("id", hostId)
        .single();

      if (hostErr || !host) {
        return NextResponse.json({ error: "Host not found" }, { status: 404 });
      }
      if (!host.address) {
        return NextResponse.json({ error: "Host has no address to geocode" }, { status: 400 });
      }

      const result = await geocodeAddress(host.address, host.city);
      if (!result) {
        return NextResponse.json({ error: "Geocoding failed — address not found" }, { status: 422 });
      }

      const { error: updateErr } = await supabase
        .from("accommodation_hosts")
        .update({
          lat: result.lat,
          lon: result.lon,
          geocoded_at: new Date().toISOString(),
          geocode_source: "nominatim",
        })
        .eq("id", hostId);

      if (updateErr) throw new Error(updateErr.message);

      return NextResponse.json({ ok: true, lat: result.lat, lon: result.lon });
    }

    // Toggle include_family_friends
    if (typeof include_family_friends !== "boolean") {
      return NextResponse.json({ error: "include_family_friends (boolean) or action required" }, { status: 400 });
    }

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
