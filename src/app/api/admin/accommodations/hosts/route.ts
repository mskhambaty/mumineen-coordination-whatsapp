import { NextRequest, NextResponse } from "next/server";

import { geocodeAddress, importAccommodationHosts } from "@/lib/accommodations/import";
import { buildHostRollups } from "@/lib/accommodations/rollups";
import { requireAdminKey } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { z } from "zod";

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
    const { hostId, action, include_family_friends, enabled_for_suggestions } = body as {
      hostId: string;
      action?: string;
      include_family_friends?: boolean;
      enabled_for_suggestions?: boolean;
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

    // Toggle enabled_for_suggestions
    if (typeof enabled_for_suggestions === "boolean") {
      const { error } = await supabase
        .from("accommodation_hosts")
        .update({ enabled_for_suggestions, updated_at: new Date().toISOString() })
        .eq("id", hostId);

      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true });
    }

    // Toggle include_family_friends
    if (typeof include_family_friends !== "boolean") {
      return NextResponse.json({ error: "include_family_friends (boolean), enabled_for_suggestions (boolean), or action required" }, { status: 400 });
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

// --- Schema for create/update host ---
const hostSchema = z.object({
  id: z.string().uuid().optional(), // if present → update; if absent → create
  hof_its: z.string().min(1, "ITS is required"),
  first_name: z.string().optional().default(""),
  last_name: z.string().optional().default(""),
  address: z.string().optional().default(""),
  city: z.string().optional().default(""),
  mobile: z.string().optional().default(""),
  capacity_mehman: z.coerce.number().int().min(0).default(0),
  capacity_family_friends: z.coerce.number().int().min(0).default(0),
  gender_preference: z.string().optional().default(""),
  sahebo_preference: z.string().optional().default(""),
  pet_type: z.string().optional().default(""),
  days_after_ashura: z.coerce.number().int().nullable().optional(),
});

/**
 * PUT /api/admin/accommodations/hosts — Create or update a single host record.
 * Body: host fields (include `id` to update, omit to create).
 */
export async function PUT(req: NextRequest) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const parsed = hostSchema.parse(body);
    const supabase = getSupabaseAdmin();

    const record = {
      hof_its: parsed.hof_its,
      first_name: parsed.first_name || null,
      last_name: parsed.last_name || null,
      address: parsed.address || null,
      city: parsed.city || null,
      mobile: parsed.mobile || null,
      capacity_mehman: parsed.capacity_mehman,
      capacity_family_friends: parsed.capacity_family_friends,
      gender_preference: parsed.gender_preference || null,
      sahebo_preference: parsed.sahebo_preference || null,
      pet_type: parsed.pet_type || null,
      days_after_ashura: parsed.days_after_ashura ?? null,
      can_provide_utaro: true,
      updated_at: new Date().toISOString(),
    };

    if (parsed.id) {
      // Update existing
      const { error } = await supabase
        .from("accommodation_hosts")
        .update(record)
        .eq("id", parsed.id);
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true, action: "updated" });
    } else {
      // Create new
      const { error } = await supabase
        .from("accommodation_hosts")
        .insert({ ...record, created_at: new Date().toISOString() });
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true, action: "created" }, { status: 201 });
    }
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.errors.map(err => err.message).join(", ") }, { status: 400 });
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
