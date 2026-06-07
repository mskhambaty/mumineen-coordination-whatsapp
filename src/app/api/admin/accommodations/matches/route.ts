import { NextRequest, NextResponse } from "next/server";

import { confirmMatch, createPendingMatch, rejectMatch, suggestMatches } from "@/lib/accommodations/matching";
import { requireAdminKey } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * GET /api/admin/accommodations/matches — List all matches or get suggestions.
 * Query params:
 *   ?action=suggest — generate ranked suggestions for unmatched guests
 *   (default) — list existing matches
 */
export async function GET(req: NextRequest) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const action = req.nextUrl.searchParams.get("action");

  try {
    if (action === "suggest") {
      const suggestions = await suggestMatches();
      return NextResponse.json({ suggestions });
    }

    // Default: list existing matches
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("accommodation_matches")
      .select(`
        id,
        guest_family_id,
        host_id,
        status,
        guest_member_count,
        notes,
        confirmed_at,
        confirmed_by,
        created_at,
        updated_at,
        accommodation_hosts (hof_its, first_name, last_name, address, city),
        families (hof_its, hotel_name)
      `)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);

    return NextResponse.json({ matches: data ?? [] });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/**
 * POST /api/admin/accommodations/matches — Create a pending match.
 * Body: { guestFamilyId, hostId, guestMemberCount, notes? }
 */
export async function POST(req: NextRequest) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { guestFamilyId, hostId, guestMemberCount, notes } = body as {
      guestFamilyId: string;
      hostId: string;
      guestMemberCount: number;
      notes?: string;
    };

    if (!guestFamilyId || !hostId || !guestMemberCount) {
      return NextResponse.json({ error: "guestFamilyId, hostId, guestMemberCount required" }, { status: 400 });
    }

    const matchId = await createPendingMatch(guestFamilyId, hostId, guestMemberCount, notes);
    return NextResponse.json({ matchId }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

/**
 * PATCH /api/admin/accommodations/matches — Confirm or reject a match.
 * Body: { matchId, action: 'confirm' | 'reject' | 'cancel', confirmedBy? }
 */
export async function PATCH(req: NextRequest) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { matchId, action, confirmedBy } = body as {
      matchId: string;
      action: "confirm" | "reject" | "cancel";
      confirmedBy?: string;
    };

    if (!matchId || !action) {
      return NextResponse.json({ error: "matchId and action required" }, { status: 400 });
    }

    if (action === "confirm") {
      await confirmMatch(matchId, confirmedBy ?? "admin");
    } else if (action === "reject" || action === "cancel") {
      await rejectMatch(matchId, action === "reject" ? "rejected" : "cancelled");
    } else {
      return NextResponse.json({ error: "Invalid action. Use: confirm, reject, cancel" }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
