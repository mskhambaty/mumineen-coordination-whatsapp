import { NextRequest, NextResponse } from "next/server";

import { notifyOnCallSupport } from "@/lib/escalation/notify";
import { getSupabaseAdmin } from "@/lib/supabase/server";

function appBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

export const runtime = "nodejs";

// Minimum inbound messages before a non-emergency escalation is allowed, so the
// AI can't hand off on a "hi" -> "talk to someone" exchange. Emergencies bypass.
const MIN_INBOUND_FOR_ESCALATION = 3;

// Only a concrete safety/emergency situation bypasses the "evaluate first" gate —
// NOT a user merely saying "urgent", "emergency", or "I need help".
const EMERGENCY_PATTERN =
  /\b(lost child|missing child|child is (lost|missing)|lost (my )?(passport|wallet)|passport (lost|stolen|missing)|medical|ambulance|hospital|accident|injur|unconscious|bleeding|police|fire|security threat)\b/i;

type EscalationBody = {
  reason?: unknown;
  priority?: unknown;
  category?: unknown;
  department?: unknown;
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
  // The model's "urgent" label does NOT bypass the gate — only real emergency wording does.
  const isEmergency = EMERGENCY_PATTERN.test(reason);
  const priority = body.priority === "urgent" ? "urgent" : "normal";

  const departmentName = typeof body.department === "string" ? body.department.trim() : "";

  const supabase = getSupabaseAdmin();

  // Resolve department name to ID when provided.
  let escalationDepartmentId: string | null = null;
  if (departmentName) {
    const { data: dept } = await supabase
      .from("departments")
      .select("id")
      .ilike("name", departmentName)
      .maybeSingle();
    escalationDepartmentId = dept?.id ?? null;
  }

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
      escalation_department_id: escalationDepartmentId,
    })
    .eq("phone_e164", phone)
    .select("id, phone_e164, escalation_status, escalation_priority, escalation_category, escalation_department_id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  // Notify currently on-call support members by email. Best-effort: a notification
  // failure must never break the agent's reply, so it's wrapped and swallowed.
  try {
    const { data: guest } = await supabase
      .from("whatsapp_users")
      .select("display_name")
      .eq("phone_e164", phone)
      .maybeSingle();

    await notifyOnCallSupport({
      guestName: guest?.display_name || phone,
      guestPhone: phone,
      reason: reason || "(no reason provided)",
      priority,
      category,
      conversationUrl: `${appBaseUrl()}/admin/conversations?phone=${encodeURIComponent(phone)}&tab=escalations`,
    });
  } catch (err) {
    console.error("Escalation notification failed:", err);
  }

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
