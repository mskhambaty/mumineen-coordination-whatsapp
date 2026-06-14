import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { canMonitorReligiousChats } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

// GET: the missing-word queue (words members asked for that aren't in the dictionary). Defaults to
// open requests, most-asked first. ?status=open|added|dismissed|all.
export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, canMonitorReligiousChats);
  if (auth instanceof NextResponse) return auth;

  const status = req.nextUrl.searchParams.get("status") ?? "open";
  let query = getSupabaseAdmin()
    .from("lisan_word_requests")
    .select("id, word, normalized_word, status, times_seen, last_phone_e164, first_seen_at, last_seen_at")
    .order("times_seen", { ascending: false })
    .order("last_seen_at", { ascending: false })
    .limit(500);
  if (status !== "all") query = query.eq("status", status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ requests: data ?? [] });
}

const patchSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["open", "added", "dismissed"]),
});

// PATCH: resolve a request (mark added once you've added the word, or dismissed if it's not a real
// word). Adding the word via /admin/knowledge auto-marks it 'added'; this is the manual override.
export async function PATCH(req: NextRequest) {
  const auth = await requirePortalCaller(req, canMonitorReligiousChats);
  if (auth instanceof NextResponse) return auth;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  const { error } = await getSupabaseAdmin()
    .from("lisan_word_requests")
    .update({ status: parsed.data.status, updated_at: new Date().toISOString() })
    .eq("id", parsed.data.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
