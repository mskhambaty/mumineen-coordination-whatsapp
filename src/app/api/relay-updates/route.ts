import { NextResponse } from "next/server";

import { toFeedItem } from "@/lib/relay-updates/shared";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

// The static relay page (asharamubaraka.net) fetches this cross-origin, so CORS must be open.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

// GET /api/relay-updates — public JSON feed for the static page's "Latest updates" section.
// Returns ONLY published rows, newest first, in the page's exact schema. ~1 min CDN cache.
export async function GET() {
  const { data, error } = await getSupabaseAdmin()
    .from("relay_updates")
    .select("id, date, title, body, category, link, cta")
    .eq("published", true)
    .order("date", { ascending: false });

  if (error) {
    // The page falls back to its baked-in updates on any non-OK response.
    return NextResponse.json({ error: error.message }, { status: 500, headers: CORS_HEADERS });
  }

  return NextResponse.json((data ?? []).map(toFeedItem), {
    headers: {
      ...CORS_HEADERS,
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
    },
  });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
