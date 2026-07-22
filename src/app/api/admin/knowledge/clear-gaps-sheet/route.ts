import { NextRequest, NextResponse } from "next/server";

import { requireAdminKey } from "@/lib/api/auth";
import { GAPS_SHEET_PAGE_URL_PREFIX } from "@/lib/knowledge/gaps-sheet-sync";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * One-off cleanup: remove gaps-sheet ("faqsheet://") entries from site_content.
 *
 * The gaps-sheet sync only ever upserts — it never prunes. So a stale row (e.g.
 * old parking-pickup times) persists in the index and can override the
 * authoritative FAQ buckets in retrieval. This endpoint deletes those entries.
 *
 * Body (optional): { contains?: string } — when provided, only faqsheet rows
 * whose content contains that substring are deleted (surgical). Without it, ALL
 * faqsheet rows are removed. Admin-key gated.
 */
export async function POST(req: NextRequest) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { contains?: unknown };
  const contains = typeof body.contains === "string" ? body.contains.trim() : "";

  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("site_content")
    .delete()
    .like("page_url", `${GAPS_SHEET_PAGE_URL_PREFIX}%`);
  if (contains) query = query.ilike("content", `%${contains}%`);

  const { data, error } = await query.select("page_url");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const pageUrls = (data ?? []).map((r) => (r as { page_url: string }).page_url);
  return NextResponse.json({ ok: true, deleted: pageUrls.length, pageUrls });
}
