import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

// GET /api/webinars — public, returns all active webinars newest-first
export async function GET() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("webinars")
    .select("id, title, youtube_url, description, created_at")
    .eq("active", true)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ webinars: data ?? [] });
}

const CreateBody = z.object({
  title: z.string().min(1).max(200),
  youtube_url: z.string().url().max(500),
  description: z.string().max(1000).nullable().optional(),
});

// POST /api/webinars — admin/leadership only
export async function POST(req: NextRequest) {
  const auth = await requirePortalCaller(req, isAdminOrLeadership);
  if (auth instanceof NextResponse) return auth;

  const raw = await req.json().catch(() => null);
  const parsed = CreateBody.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("webinars")
    .insert({
      title: parsed.data.title,
      youtube_url: parsed.data.youtube_url,
      description: parsed.data.description ?? null,
      created_by_name: auth.caller.display_name ?? null,
    })
    .select("id, title, youtube_url, description, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ webinar: data }, { status: 201 });
}
