import { NextRequest, NextResponse } from "next/server";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { __resetSlaCacheForTests } from "@/lib/escalation/sla";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, isAdminOrLeadership);
  if (auth instanceof NextResponse) return auth;

  const { data } = await getSupabaseAdmin()
    .from("escalation_sla_config")
    .select("priority, pickup_minutes, updated_at");

  const rows = (data ?? []) as Array<{ priority: string; pickup_minutes: number; updated_at: string }>;
  const config: Record<string, { pickup_minutes: number; updated_at?: string }> = {};
  for (const row of rows) {
    config[row.priority] = { pickup_minutes: row.pickup_minutes, updated_at: row.updated_at };
  }

  return NextResponse.json(config);
}

export async function PUT(req: NextRequest) {
  const auth = await requirePortalCaller(req, isAdminOrLeadership);
  if (auth instanceof NextResponse) return auth;

  const body = (await req.json().catch(() => ({}))) as {
    urgent_minutes?: unknown;
    normal_minutes?: unknown;
  };

  const updates: Array<{ priority: string; pickup_minutes: number }> = [];

  if (body.urgent_minutes !== undefined) {
    const m = Number(body.urgent_minutes);
    if (!Number.isInteger(m) || m < 1 || m > 1440) {
      return NextResponse.json({ error: "urgent_minutes must be 1-1440" }, { status: 400 });
    }
    updates.push({ priority: "urgent", pickup_minutes: m });
  }
  if (body.normal_minutes !== undefined) {
    const m = Number(body.normal_minutes);
    if (!Number.isInteger(m) || m < 1 || m > 1440) {
      return NextResponse.json({ error: "normal_minutes must be 1-1440" }, { status: 400 });
    }
    updates.push({ priority: "normal", pickup_minutes: m });
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: "Provide urgent_minutes and/or normal_minutes" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();

  for (const u of updates) {
    const { error } = await supabase
      .from("escalation_sla_config")
      .update({ pickup_minutes: u.pickup_minutes, updated_at: now })
      .eq("priority", u.priority);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // Bust the in-memory cache so the next escalation uses the new deadline.
  __resetSlaCacheForTests();

  return NextResponse.json({ updated: updates });
}
