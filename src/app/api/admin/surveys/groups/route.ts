import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { runFilterDetailed, validateRules, type RuleGroup } from "@/lib/whatsapp/audience-filter";

export const runtime = "nodejs";

// GET — list active groups (with a live reachable count). POST — create a group from a rule tree.
export async function GET(req: NextRequest) {
  const guard = await requirePortalCaller(req, isAdminOrLeadership);
  if (guard instanceof NextResponse) return guard;
  const { data } = await getSupabaseAdmin().from("survey_groups").select("id, name, description, rules, area_focus, active").eq("active", true).order("name");
  return NextResponse.json({ groups: data ?? [] });
}

const bodySchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(500).optional(),
  rules: z.unknown(),
  area_focus: z.string().max(60).optional(),
});

export async function POST(req: NextRequest) {
  const guard = await requirePortalCaller(req, isAdminOrLeadership);
  if (guard instanceof NextResponse) return guard;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });

  const ruleErr = validateRules(parsed.data.rules as RuleGroup);
  if (ruleErr) return NextResponse.json({ error: `Invalid rules: ${ruleErr}` }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("survey_groups")
    .insert({ name: parsed.data.name, description: parsed.data.description ?? null, rules: parsed.data.rules, area_focus: parsed.data.area_focus ?? null })
    .select("id, name, description, rules, area_focus, active")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: error.code === "23505" ? 409 : 500 });

  // Best-effort reachable count for immediate feedback in the UI.
  let reachable = 0;
  try { reachable = (await runFilterDetailed(parsed.data.rules as RuleGroup)).recipients.length; } catch { /* ignore */ }
  return NextResponse.json({ group: data, reachable }, { status: 201 });
}
