import { NextRequest, NextResponse } from "next/server";

import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Minimum inbound messages before a non-emergency escalation is allowed, so the
// AI can't hand off on a "hi" -> "talk to someone" exchange. Emergencies bypass.
const MIN_INBOUND_FOR_ESCALATION = 3;

const EMERGENCY_PATTERN =
  /\b(lost child|missing child|lost (my )?(passport|wallet|child)|child is (lost|missing)|medical|ambulance|emergency|urgent help|accident|injur|police|security threat|fire)\b/i;

type EscalationBody = {
  reason?: unknown;
  priority?: unknown;
  category?: unknown;
  source?: unknown;
};

export async function POST(req: NextRequest) {
  const phone = req.headers.get("x-whatsapp-from");
  if (!phone) {
    return NextResponse.json({ error: "Missing x-whatsapp-from header" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as EscalationBody;
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  const category = typeof body.category === "string" ? body.category : "other";
  const source = body.source === "rule" || body.source === "manual" ? body.source : "ai";
  const isEmergency = body.priority === "urgent" || EMERGENCY_PATTERN.test(reason);
  const priority = isEmergency ? "urgent" : "normal";

  const supabase = getSupabaseAdmin();

  // Guardrail: non-emergencies need a few exchanges first (last-resort behaviour).
  if (!isEmergency) {
    const { count } = await supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("phone_e164", phone)
      .eq("direction", "inbound");

    if ((count ?? 0) < MIN_INBOUND_FOR_ESCALATION) {
      return NextResponse.json({
        status: "declined",
        message:
          "Keep helping the user directly. Ask what they need and try get_site_content_faq before escalating.",
      });
    }
  }

  const { data, error } = await supabase
    .from("conversation_sessions")
    .update({
      escalation_status: "pending",
      escalation_reason: reason || null,
      escalation_priority: priority,
      escalation_category: category,
      escalated_at: new Date().toISOString(),
      escalation_source: source,
    })
    .eq("phone_e164", phone)
    .select("id, phone_e164, escalation_status, escalation_priority, escalation_category")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  // Phase 3 will notify on-call support members here (email + WhatsApp template).

  return NextResponse.json({
    status: "escalated",
    priority,
    category,
    message:
      priority === "urgent"
        ? "Escalated to the support team as urgent. Reassure the user that someone will reach out right away."
        : "Escalated to the support team. Let the user know someone from the team will follow up shortly.",
  });
}
