import { NextRequest, NextResponse } from "next/server";

import { canMonitorReligiousChats } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { RELIGIOUS_TOOL_NAMES } from "@/lib/admin/religious-transcript";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Pull the status out of a get_lisan_word_meaning audit row's result_summary ("ok" / "did_you_mean"
// / "not_found"). result_summary is a JSON string like {"status":"not_found"}.
function lisanStatus(resultSummary: string | null): string | null {
  if (!resultSummary) return null;
  try {
    const v = JSON.parse(resultSummary) as { status?: unknown };
    return typeof v.status === "string" ? v.status : null;
  } catch {
    return null;
  }
}

// GET: aggregate metrics for the religious dashboard. Optional ?from / ?to (YYYY-MM-DD); defaults
// to the last 30 days. Counts are computed in memory from a single bounded read (same pattern as
// registration-analytics).
export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, canMonitorReligiousChats);
  if (auth instanceof NextResponse) return auth;

  const params = req.nextUrl.searchParams;
  const from = params.get("from");
  const to = params.get("to");
  const fromIso = from ? `${from}T00:00:00.000Z` : new Date(Date.now() - 30 * 86400_000).toISOString();
  const toIso = to ? `${to}T23:59:59.999Z` : null;

  const supabase = getSupabaseAdmin();

  let auditQuery = supabase
    .from("tool_audit_logs")
    .select("tool_name, arguments, result_summary, phone_e164, created_at")
    .in("tool_name", [...RELIGIOUS_TOOL_NAMES])
    .gte("created_at", fromIso)
    .order("created_at", { ascending: false })
    .limit(5000);
  if (toIso) auditQuery = auditQuery.lte("created_at", toIso);

  const [{ data: audit, error }, openReq, rulingFlags] = await Promise.all([
    auditQuery,
    supabase.from("lisan_word_requests").select("id", { count: "exact", head: true }).eq("status", "open"),
    supabase.from("religious_ruling_flags").select("id", { count: "exact", head: true }).eq("reviewed", false),
  ]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (audit ?? []) as {
    tool_name: string;
    arguments: { word?: unknown; query?: unknown } | null;
    result_summary: string | null;
    phone_e164: string | null;
  }[];

  const members = new Set<string>();
  let waaz = 0;
  let lisan = 0;
  const lisanByStatus: Record<string, number> = { ok: 0, did_you_mean: 0, not_found: 0 };
  const wordCounts = new Map<string, number>();

  for (const r of rows) {
    if (r.phone_e164) members.add(r.phone_e164);
    if (r.tool_name === "answer_religious_questions") waaz += 1;
    if (r.tool_name === "get_lisan_word_meaning") {
      lisan += 1;
      const status = lisanStatus(r.result_summary);
      if (status && status in lisanByStatus) lisanByStatus[status] += 1;
      const word = typeof r.arguments?.word === "string" ? r.arguments.word.trim() : "";
      if (word) wordCounts.set(word, (wordCounts.get(word) ?? 0) + 1);
    }
  }

  const topWords = Array.from(wordCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word, count]) => ({ word, count }));

  return NextResponse.json({
    range: { from: fromIso, to: toIso },
    summary: {
      total_calls: rows.length,
      unique_members: members.size,
      waaz_questions: waaz,
      lisan_lookups: lisan,
      lisan_by_status: lisanByStatus,
      open_word_requests: openReq.count ?? 0,
      unreviewed_ruling_flags: rulingFlags.count ?? 0,
    },
    top_words: topWords,
  });
}
