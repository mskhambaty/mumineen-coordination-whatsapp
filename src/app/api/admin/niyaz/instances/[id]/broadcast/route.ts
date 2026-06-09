import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { canAccessPortal, isAdminOrLeadership } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getEvents } from "@/lib/rsvp/meal-rsvp";
import { buildNiyazSend, createHeadCountPrompts, resolveNiyazAudience, type NiyazAudienceKind } from "@/lib/rsvp/niyaz-prompt";
import { createBroadcast } from "@/lib/whatsapp/broadcast";
import { resolveApprovedTemplate } from "@/lib/whatsapp/send-template";
import { MAPPABLE_FIELDS, type Binding, type VariableBindings } from "@/lib/whatsapp/templates";

export const runtime = "nodejs";

const AUDIENCES = ["specific_its", "all_mumineen", "all_hof", "all_adults"] as const;

const bodySchema = z.object({
  audience: z.enum(AUDIENCES),
  its: z.array(z.string()).optional(),
  only_non_responders: z.boolean().optional(),
  level: z.enum(["ind", "fam"]),
  template_code: z.string().min(1),
  // "buttons" = quick-reply RSVP (per-mumin/family yes/no); "headcount" = free-text family head count.
  mode: z.enum(["buttons", "headcount"]).optional(),
  registration_message: z.string().optional(),
  example_response: z.string().optional(),
});

const FIELD_KEYS = new Set(MAPPABLE_FIELDS.map((f) => f.key));

type BindCtx = { dayLabel: string; mealLabel: string; registrationMessage: string; exampleResponse: string };

// Bind a template variable token to a per-recipient field or a per-send static value.
function bindToken(token: string, ctx: BindCtx): Binding {
  const t = token.toLowerCase();
  if (t === "name" || t === "person_name" || t === "full_name") return { kind: "field", field: "full_name" };
  if (t === "family_members") return { kind: "field", field: "family_members" };
  if (FIELD_KEYS.has(token)) return { kind: "field", field: token };
  if (["day", "date", "when", "days"].includes(t)) return { kind: "static", value: ctx.dayLabel };
  if (["meal", "meals"].includes(t)) return { kind: "static", value: ctx.mealLabel };
  if (["registration_message", "message", "reg_message"].includes(t)) return { kind: "static", value: ctx.registrationMessage };
  if (["example_response", "example", "example_reply"].includes(t)) return { kind: "static", value: ctx.exampleResponse };
  return { kind: "static", value: ctx.dayLabel };
}

async function eventDate(id: string): Promise<string | null> {
  const ev = (await getEvents()).find((e) => e.id === id);
  return ev?.eventDate ?? null;
}

// GET — recipient count preview for the chosen audience/filters/level (so the UI can show it).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePortalCaller(req, canAccessPortal);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const date = await eventDate(id);
  if (!date) return NextResponse.json({ error: "Event has no date." }, { status: 400 });

  const sp = req.nextUrl.searchParams;
  const audience = sp.get("audience") as NiyazAudienceKind | null;
  if (!audience || !(AUDIENCES as readonly string[]).includes(audience)) {
    return NextResponse.json({ error: "Invalid audience." }, { status: 400 });
  }
  const level = sp.get("level") === "fam" ? "fam" : "ind";
  const onlyNonResponders = sp.get("only_non_responders") === "true";
  const its = (sp.get("its") ?? "").split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);

  const { recipients, unresolvedIts } = await resolveNiyazAudience({ date, audience, its, onlyNonResponders, level });
  return NextResponse.json({ count: recipients.length, unresolved_its: unresolvedIts });
}

// POST — send the daily RSVP template (with date-encoded button payloads) via the broadcast queue.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePortalCaller(req, isAdminOrLeadership);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const date = await eventDate(id);
  if (!date) return NextResponse.json({ error: "Event has no date." }, { status: 400 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  }
  const { audience, its, only_non_responders, level, template_code } = parsed.data;
  const mode = parsed.data.mode ?? "buttons";

  const { recipients, unresolvedIts } = await resolveNiyazAudience({ date, audience, its, onlyNonResponders: only_non_responders, level });
  if (recipients.length === 0) {
    return NextResponse.json({ error: "No recipients for this audience.", unresolved_its: unresolvedIts }, { status: 400 });
  }

  let desc;
  try {
    desc = await resolveApprovedTemplate(template_code);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Template not found" }, { status: 400 });
  }

  const { dayLabel, mealLabel, quickReplyButtons } = await buildNiyazSend(date, level);
  const ctx: BindCtx = {
    dayLabel,
    mealLabel,
    registrationMessage: parsed.data.registration_message?.trim() || `Niyaz RSVP for ${dayLabel}: ${mealLabel}.`,
    exampleResponse: parsed.data.example_response?.trim() || "4",
  };
  const bindings: VariableBindings = { body: {} };
  for (const tok of desc.bodyVars) bindings.body![tok] = bindToken(tok, ctx);
  if (desc.header?.format === "TEXT" && desc.headerVar) bindings.header = bindToken(desc.headerVar, ctx);

  const result = await createBroadcast({
    templateCode: template_code,
    templateLanguage: desc.language,
    recipients,
    variableBindings: bindings,
    // Buttons mode stamps the date into quick-reply payloads; head-count mode is a free-text template
    // (no buttons) and instead logs a pending prompt so the numeric reply maps back to this date.
    quickReplyButtons: mode === "buttons" ? quickReplyButtons : undefined,
    triggeredByUserId: auth.caller?.user_id ?? null,
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error, unresolved_its: unresolvedIts }, { status: 400 });
  }

  if (mode === "headcount") {
    await createHeadCountPrompts(
      recipients.map((r) => ({ phone: r.phone, familyId: r.familyId })),
      date,
    );
  }

  return NextResponse.json({ status: "started", mode, ...result, unresolved_its: unresolvedIts });
}
