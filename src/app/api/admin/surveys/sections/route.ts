import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { FEEDBACK_AREAS } from "@/lib/feedback/areas";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

// POST /api/admin/surveys/sections — add a databank section. `area` ties the section to a feedback
// area (drives department routing); `is_general` marks it as asked of everyone in a form. The slug
// `key` is derived from the title (unique) so the admin only types a title.
const bodySchema = z.object({
  title: z.string().min(3).max(120),
  area: z.enum(FEEDBACK_AREAS),
  description: z.string().max(500).optional(),
  is_general: z.boolean().optional(),
});

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "section";
}

export async function POST(req: NextRequest) {
  const guard = await requirePortalCaller(req, isAdminOrLeadership);
  if (guard instanceof NextResponse) return guard;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  const b = parsed.data;

  const supabase = getSupabaseAdmin();

  // Unique slug: append a numeric suffix if the base key is taken.
  const base = slugify(b.title);
  const { data: existing } = await supabase.from("survey_sections").select("key").like("key", `${base}%`);
  const taken = new Set(((existing ?? []) as { key: string }[]).map((r) => r.key));
  let key = base;
  for (let i = 2; taken.has(key); i++) key = `${base}_${i}`;

  // New sections sort to the end of the active list.
  const { data: maxRow } = await supabase
    .from("survey_sections")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const sortOrder = ((maxRow as { sort_order: number } | null)?.sort_order ?? 0) + 10;

  const { data, error } = await supabase
    .from("survey_sections")
    .insert({
      key,
      title: b.title,
      area: b.area,
      description: b.description ?? null,
      is_general: b.is_general ?? false,
      sort_order: sortOrder,
    })
    .select("id, key, title, description, area, is_general, sort_order, active")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ section: { ...data, questions: [] } }, { status: 201 });
}
