import { NextRequest, NextResponse } from "next/server";

import { requireAdminKey } from "@/lib/api/auth";
import {
  listMessageTemplates,
  sendWhatsAppTemplateComponents,
  sendWhatsAppText,
} from "@/lib/meta/whatsapp";
import { str } from "@/lib/registration/normalize";
import { getSupabaseAdmin, recordOutboundMessage } from "@/lib/supabase/server";
import { buildSendComponents, describeTemplate, previewBody } from "@/lib/whatsapp/templates";

export const runtime = "nodejs";

type TemplatePayload = {
  name?: unknown;
  language?: unknown;
  bodyParams?: unknown;
  headerText?: unknown;
  headerMediaUrl?: unknown;
  urlButtonParam?: unknown;
};
type SendBody = { its?: unknown; phone?: unknown; kind?: unknown; text?: unknown; template?: TemplatePayload };

function normalizePhone(input: string): string {
  const digits = input.replace(/[^\d]/g, "");
  return digits ? `+${digits}` : input;
}
function looksLikePhone(input: string): boolean {
  return /^\+/.test(input.trim()) || input.replace(/\D/g, "").length >= 10;
}

// Resolve an ITS or phone to a destination number. Unlike the roster RSVP flow, general comms can
// target any number, so a phone is used as-is (name enriched from links if we happen to know it).
async function resolveTo(itsOrPhone: string): Promise<{ phone: string; name: string | null }> {
  const supabase = getSupabaseAdmin();
  const input = itsOrPhone.trim();
  if (looksLikePhone(input)) {
    return { phone: normalizePhone(input), name: null };
  }
  const { data: mumin } = await supabase
    .from("mumineen")
    .select("whatsapp_e164, full_name")
    .eq("its", input)
    .eq("roster_active", true)
    .maybeSingle();
  if (!mumin) throw new Error(`No roster member found for ITS ${input}.`);
  if (!mumin.whatsapp_e164) throw new Error(`ITS ${input} has no WhatsApp number on file.`);
  return { phone: normalizePhone(mumin.whatsapp_e164), name: mumin.full_name };
}

// POST /api/admin/whatsapp/send — send a free-text or template message to one recipient.
export async function POST(req: NextRequest) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as SendBody;

  const kind = str(body.kind);
  if (kind !== "text" && kind !== "template") {
    return NextResponse.json({ error: "kind must be 'text' or 'template'." }, { status: 400 });
  }
  const itsOrPhone = str(body.its) ?? str(body.phone);
  if (!itsOrPhone) {
    return NextResponse.json({ error: "Enter an ITS or phone number." }, { status: 400 });
  }

  try {
    const to = await resolveTo(itsOrPhone);

    if (kind === "text") {
      const text = str(body.text);
      if (!text) return NextResponse.json({ error: "Message text is empty." }, { status: 400 });
      const res = await sendWhatsAppText(to.phone, text);
      await recordOutboundMessage({
        phoneE164: to.phone,
        body: text,
        whatsappMessageId: res.messages?.[0]?.id,
        rawPayload: { source: "whatsapp_composer", kind: "text", meta_response: res },
      });
      return NextResponse.json({ ok: true, to: to.phone, name: to.name, kind });
    }

    // kind === "template"
    const t = body.template ?? {};
    const name = str(t.name);
    const language = str(t.language);
    if (!name || !language) return NextResponse.json({ error: "Template name and language are required." }, { status: 400 });

    // Re-fetch + describe the template so we build a payload that matches its real components.
    const all = await listMessageTemplates();
    const raw = all.find((x) => x.name === name && x.language === language && x.status?.toUpperCase() === "APPROVED");
    if (!raw) return NextResponse.json({ error: `Approved template ${name} (${language}) not found.` }, { status: 404 });
    const desc = describeTemplate(raw);

    const bodyParams = Array.isArray(t.bodyParams) ? (t.bodyParams as unknown[]).map((v) => String(v ?? "")) : [];
    if (bodyParams.filter((v) => v.trim()).length < desc.bodyVarCount) {
      return NextResponse.json({ error: `Template needs ${desc.bodyVarCount} variable(s).` }, { status: 400 });
    }

    const components = buildSendComponents(
      {
        bodyParams,
        headerText: str(t.headerText),
        headerMediaUrl: str(t.headerMediaUrl),
        urlButtonParam: str(t.urlButtonParam),
      },
      desc,
    );

    const res = await sendWhatsAppTemplateComponents(to.phone, name, language, components);
    await recordOutboundMessage({
      phoneE164: to.phone,
      body: `[template:${name}] ${previewBody(desc.bodyText, bodyParams)}`.trim(),
      whatsappMessageId: res.messages?.[0]?.id,
      rawPayload: { source: "whatsapp_composer", kind: "template", template: name, meta_response: res },
    });
    return NextResponse.json({ ok: true, to: to.phone, name: to.name, kind, template: name });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Send failed" }, { status: 400 });
  }
}
