import { NextRequest, NextResponse } from "next/server";

import { requireAdminKey } from "@/lib/api/auth";
import { oneOf, str, ts } from "@/lib/registration/normalize";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

const STATUSES = ["draft", "open", "closed"] as const;

const INSTANCE_COLS =
  "id, title, status, event_at, venue_name, venue_address, description, opens_at, closes_at, created_at, updated_at";

type InstanceBody = {
  title?: unknown;
  event_at?: unknown;
  venue_name?: unknown;
  venue_address?: unknown;
  description?: unknown;
  status?: unknown;
  opens_at?: unknown;
  closes_at?: unknown;
};

// GET /api/admin/niyaz/instances — list Niyaz registration instances with per-instance tallies
// (latest submission per family).
export async function GET(req: NextRequest) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const supabase = getSupabaseAdmin();

  const { data: instances, error } = await supabase
    .from("rsvp_registration_instance")
    .select(INSTANCE_COLS)
    .order("event_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Tally latest-per-family responses across all instances in one pass.
  const { data: responses } = await supabase
    .from("rsvp_responses")
    .select("registration_instance_id, family_id, response, head_count, submitted_at")
    .order("submitted_at", { ascending: false });

  const tallies = new Map<string, { responded_families: number; yes_count: number; total_head_count: number }>();
  const seen = new Set<string>(); // instance:family — first seen is the latest (desc order)
  for (const r of responses ?? []) {
    const key = `${r.registration_instance_id}:${r.family_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const t = tallies.get(r.registration_instance_id) ?? { responded_families: 0, yes_count: 0, total_head_count: 0 };
    t.responded_families += 1;
    if (r.response === "yes") {
      t.yes_count += 1;
      t.total_head_count += r.head_count ?? 0;
    }
    tallies.set(r.registration_instance_id, t);
  }

  const withTallies = (instances ?? []).map((c) => ({
    ...c,
    tally: tallies.get(c.id) ?? { responded_families: 0, yes_count: 0, total_head_count: 0 },
  }));

  return NextResponse.json({ instances: withTallies });
}

// POST /api/admin/niyaz/instances — create a Niyaz registration instance.
export async function POST(req: NextRequest) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as InstanceBody;
  const title = str(body.title);
  if (!title) {
    return NextResponse.json({ error: "Title is required." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("rsvp_registration_instance")
    .insert({
      title,
      status: oneOf(body.status, STATUSES) ?? "draft",
      event_at: ts(body.event_at),
      venue_name: str(body.venue_name),
      venue_address: str(body.venue_address),
      description: str(body.description),
      opens_at: ts(body.opens_at),
      closes_at: ts(body.closes_at),
    })
    .select(INSTANCE_COLS)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ instance: data }, { status: 201 });
}
