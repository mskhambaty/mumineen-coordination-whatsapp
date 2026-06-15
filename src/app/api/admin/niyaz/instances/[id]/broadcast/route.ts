import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { canAccessPortal, isAdminOrLeadership } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getEventConfig, type NiyazEventConfig } from "@/lib/rsvp/event-config";
import { getEvents } from "@/lib/rsvp/meal-rsvp";
import { buildNiyazSend, createHeadCountPrompts, resolveNiyazAudience, type NiyazAudienceKind } from "@/lib/rsvp/niyaz-prompt";
import { createBroadcast } from "@/lib/whatsapp/broadcast";
import { resolveApprovedTemplateForAnyAccount } from "@/lib/whatsapp/send-template";
import { MAPPABLE_FIELDS, type Binding, type ButtonBinding, type VariableBindings } from "@/lib/whatsapp/templates";

export const runtime = "nodejs";

const AUDIENCES = ["specific_its", "all_mumineen", "all_hof", "all_adults"] as const;

// Per-recipient button payload spec (templated; {{tokens}} resolved per recipient at send time).
const flowButtonSchema = z.object({
  type: z.literal("flow"),
  index: z.number().int().min(0),
  flow_token: z.string().min(1),
  flow_action_data: z.record(z.string(), z.string()).default({}),
});
const quickReplyButtonSchema = z.object({
  type: z.literal("quick_reply"),
  index: z.number().int().min(0),
  payload: z.string().min(1),
});
const buttonSchema = z.discriminatedUnion("type", [flowButtonSchema, quickReplyButtonSchema]);

// Per-variable binding (static value, or a per-recipient roster field) — the same shape the Send
// Templates console uses. When supplied, these override the auto-bound defaults below.
const bindingValueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("static"), value: z.string() }),
  z.object({ kind: z.literal("field"), field: z.string().min(1) }),
]);

const bodySchema = z.object({
  audience: z.enum(AUDIENCES),
  its: z.array(z.string()).optional(),
  only_non_responders: z.boolean().optional(),
  // Default true (legacy submitted-registration filter). The double-RSVP audiences send false.
  require_registered: z.boolean().optional(),
  level: z.enum(["ind", "fam"]),
  template_code: z.string().min(1),
  // "buttons" = quick-reply RSVP (per-mumin/family yes/no); "headcount" = free-text family head count.
  mode: z.enum(["buttons", "headcount"]).optional(),
  registration_message: z.string().optional(),
  example_response: z.string().optional(),
  // Custom per-recipient button payloads (e.g. ashara_relay_double_rsvp's Flow + quick-reply
  // buttons). When provided, these replace the auto-generated niyaz quick-reply buttons.
  buttons: z.array(buttonSchema).optional(),
  // Explicit per-variable bindings from the composer (static value or roster field). Override the
  // auto-bound defaults per body token; an optional header binding too.
  variable_bindings: z
    .object({
      body: z.record(z.string(), bindingValueSchema).optional(),
      header: bindingValueSchema.optional(),
    })
    .optional(),
});

const FIELD_KEYS = new Set(MAPPABLE_FIELDS.map((f) => f.key));

type BindCtx = {
  dayLabel: string;
  mealLabel: string;
  registrationMessage: string;
  exampleResponse: string;
  config: NiyazEventConfig | null;
};

// Bind a template variable token to a per-recipient field or a per-send static value. Event-config
// values (rsvp_event_title / lunch_menu / dinner_menu / rsvp_end_time) bind as statics for the day.
function bindToken(token: string, ctx: BindCtx): Binding {
  const t = token.toLowerCase();
  if (t === "name" || t === "person_name" || t === "full_name") return { kind: "field", field: "full_name" };
  if (t === "family_members") return { kind: "field", field: "family_members" };
  if (t === "rsvp_event_title") return { kind: "static", value: ctx.config?.rsvpEventTitle ?? ctx.dayLabel };
  if (t === "lunch_menu" || t === "lunch") return { kind: "static", value: ctx.config?.lunchMenu ?? "" };
  if (t === "dinner_menu" || t === "dinner") return { kind: "static", value: ctx.config?.dinnerMenu ?? "" };
  if (t === "rsvp_end_time" || t === "end_time") return { kind: "static", value: ctx.config?.rsvpEndTime ?? "" };
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

// Show only the last 4 digits in the audience preview so the admin can sanity-check the list
// without exposing full numbers.
function maskPhone(phone: string): string {
  const digits = phone.replace(/[^\d]/g, "");
  return digits.length >= 4 ? `••••${digits.slice(-4)}` : "••••";
}

// GET — audience preview: recipient count + a sample list (name/ITS/masked phone) for the chosen
// audience/filters/level, so the composer can show who will receive the broadcast.
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
  const requireRegistered = sp.get("require_registered") !== "false";
  const its = (sp.get("its") ?? "").split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);

  const { recipients, unresolvedIts } = await resolveNiyazAudience({ date, audience, its, onlyNonResponders, level, requireRegistered });
  const sample = recipients.slice(0, 100).map((r) => ({
    name: (r.fields?.full_name as string | undefined) ?? null,
    its: (r.fields?.its as string | undefined) ?? null,
    phone_masked: maskPhone(r.phone),
  }));
  return NextResponse.json({ count: recipients.length, unresolved_its: unresolvedIts, sample });
}

// POST — send the daily RSVP template via the broadcast queue. Body buttons (the ashara double-RSVP
// Flow + quick-reply buttons) are resolved per recipient; otherwise the legacy niyaz quick-reply
// buttons are used.
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
  const { audience, its, only_non_responders, require_registered, level, template_code } = parsed.data;
  const mode = parsed.data.mode ?? "buttons";

  const { recipients, unresolvedIts } = await resolveNiyazAudience({
    date,
    audience,
    its,
    onlyNonResponders: only_non_responders,
    level,
    requireRegistered: require_registered,
  });
  if (recipients.length === 0) {
    return NextResponse.json({ error: "No recipients for this audience.", unresolved_its: unresolvedIts }, { status: 400 });
  }

  let desc;
  let account;
  try {
    ({ descriptor: desc, account } = await resolveApprovedTemplateForAnyAccount(template_code));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Template not found" }, { status: 400 });
  }

  const config = await getEventConfig(date);
  const { dayLabel, mealLabel, quickReplyButtons } = await buildNiyazSend(date, level);
  const ctx: BindCtx = {
    dayLabel,
    mealLabel,
    registrationMessage: parsed.data.registration_message?.trim() || `Niyaz RSVP for ${dayLabel}: ${mealLabel}.`,
    exampleResponse: parsed.data.example_response?.trim() || "4",
    config,
  };
  // Each body variable binds to the explicit composer binding when provided, else the auto-bound
  // default (event-config value / person field).
  const clientBindings = parsed.data.variable_bindings;
  const bindings: VariableBindings = { body: {} };
  for (const tok of desc.bodyVars) bindings.body![tok] = clientBindings?.body?.[tok] ?? bindToken(tok, ctx);
  if (clientBindings?.header) bindings.header = clientBindings.header;
  else if (desc.header?.format === "TEXT" && desc.headerVar) bindings.header = bindToken(desc.headerVar, ctx);

  // Custom button payloads (ashara double-RSVP). Resolved per recipient; {{RegistrationInstanceId}}
  // is this instance's id.
  const customButtons: ButtonBinding[] | undefined = parsed.data.buttons?.map((b) =>
    b.type === "flow"
      ? { type: "flow" as const, index: b.index, flowToken: b.flow_token, flowActionData: b.flow_action_data }
      : { type: "quick_reply" as const, index: b.index, payload: b.payload },
  );
  if (customButtons && customButtons.length > 0) {
    bindings.buttons = customButtons;
    bindings.buttonTokens = { RegistrationInstanceId: id };
  }

  const result = await createBroadcast({
    templateCode: template_code,
    templateLanguage: desc.language,
    account,
    recipients,
    variableBindings: bindings,
    // Legacy niyaz buttons only when no custom button spec was given and we're in buttons mode.
    // Head-count mode is a free-text template (no buttons) and logs a pending prompt instead.
    quickReplyButtons: customButtons ? undefined : mode === "buttons" ? quickReplyButtons : undefined,
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
