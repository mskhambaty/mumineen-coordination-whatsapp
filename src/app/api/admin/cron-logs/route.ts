import { NextRequest, NextResponse } from "next/server";

import { requireAdminKey } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const jobKey = req.nextUrl.searchParams.get("job_key");
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 20) || 20, 100);

  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("cron_job_logs")
    .select("id, job_key, started_at, completed_at, status, metadata, error_message")
    .order("started_at", { ascending: false })
    .limit(limit);

  if (jobKey) {
    query = query.eq("job_key", jobKey);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ logs: data ?? [] });
}
