import { NextRequest, NextResponse } from "next/server";

import { notifyEscalationTeam } from "@/lib/escalation/notify";
import { notifyDepartmentIssueContacts } from "@/lib/issues/notify";
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

// Categories that bypass the min-inbound gate. A "religious_followup" is a one-shot
// deen/Waaz question the reflections can't answer (often the very first message) — it is
// a content hand-off, not a "get me a human" complaint, so the gate must not block it.
const GATE_EXEMPT_CATEGORIES = new Set(["religious_followup", "lost_found"]);

// Only a concrete safety/emergency situation bypasses the "evaluate first" gate —
// NOT a user merely saying "urgent", "emergency", or "I need help".
const EMERGENCY_PATTERN =
  /\b(lost child|missing child|child is (lost|missing)|lost (my )?(passport|wallet)|passport (lost|stolen|missing)|medical|ambulance|hospital|accident|injur|unconscious|bleeding|police|fire|security threat)\b/i;

type EscalationBody = {
  reason?: unknown;
  title?: unknown;
  description?: unknown;
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
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
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
  // Emergencies and gate-exempt categories (e.g. religious_followup) skip this.
  if (!isEmergency && !GATE_EXEMPT_CATEGORIES.has(category)) {
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

  const escalatedAt = new Date().toISOString();

  // Compute SLA deadline for the triage desk.
  let slaDeadline: string | null = null;
  try {
    const { computeSlaDeadline } = await import("@/lib/escalation/sla");
    const deadline = await computeSlaDeadline(priority as "urgent" | "normal", new Date(escalatedAt));
    slaDeadline = deadline.toISOString();
  } catch {
    // SLA config unavailable — leave deadline null
  }

  const { data, error } = await supabase
    .from("conversation_sessions")
    .update({
      // escalation_status is derived from escalation_stage by a DB trigger — set stage only.
      escalation_stage: "pending",
      escalation_reason: reason || null,
      escalation_priority: priority,
      escalation_category: category,
      escalated_at: escalatedAt,
      escalation_source: source,
      escalation_department_id: escalationDepartmentId,
      escalation_sla_deadline: slaDeadline,
      // Reset assignment fields in case this is a re-escalation
      escalation_assigned_to: null,
      escalation_assigned_at: null,
      linked_task_id: null,
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

  // Log escalation activity for the triage desk timeline.
  try {
    const { logEscalationActivity } = await import("@/lib/escalation/activity");
    await logEscalationActivity({
      sessionId: data.id,
      phoneE164: phone,
      action: "escalated",
      actorLabel: source === "ai" ? "AI Agent" : source === "rule" ? "System Rule" : "Manual",
      details: { reason, priority, category },
    });
  } catch {
    // fire-and-forget
  }

  // An escalation does NOT topically auto-link to OTHER conversations' issues (that over-grouped
  // unrelated escalations; cross-conversation grouping is human-confirmed via the suggestions
  // endpoint). But it IS idempotent for THIS conversation: if the same conversation already has an
  // open linked issue — e.g. the agent called move_to_escalation more than once in the chat, which
  // produced the ISS-21/ISS-22 duplicate ~18s apart — reuse it instead of minting a duplicate.
  const issueTitle = title || reason || "Escalation";
  const issuePriority = priority === "urgent" ? "high" : "medium";
  let issueId: string | null = null;
  let deduplicated = false;

  // Re-escalation guard: reuse an OPEN issue already linked to this conversation.
  try {
    const { data: priorLinks } = await supabase
      .from("issue_escalation_links")
      .select("issue_id, issues(status)")
      .eq("conversation_session_id", data.id);
    const links = (priorLinks ?? []) as Array<{ issue_id: string; issues: { status: string } | { status: string }[] | null }>;
    const openLink = links.find((l) => {
      const issue = Array.isArray(l.issues) ? l.issues[0] : l.issues;
      const status = issue?.status;
      return status != null && status !== "resolved" && status !== "closed";
    });
    if (openLink) {
      issueId = openLink.issue_id;
      deduplicated = true;
      await supabase
        .from("conversation_sessions")
        .update({ linked_issue_id: issueId })
        .eq("id", data.id);
      try {
        const { logEscalationActivity } = await import("@/lib/escalation/activity");
        await logEscalationActivity({
          sessionId: data.id,
          issueId,
          phoneE164: phone,
          action: "linked_to_issue",
          actorLabel: "AI Agent",
          details: { deduplicated: true, reason: "conversation already has an open issue" },
        });
      } catch {
        // fire-and-forget
      }
    }
  } catch (err) {
    console.error("Re-escalation idempotency check failed; will create a new issue:", err);
  }

  // Create the new issue + workspace task (only when this conversation has no open issue yet).
  if (!issueId) {
    try {
      const { data: issue } = await supabase
        .from("issues")
        .insert({
          title: issueTitle,
          description: description || reason || null,
          priority: issuePriority,
          department_id: escalationDepartmentId,
        })
        .select("id, title")
        .single();

      if (issue) {
        issueId = issue.id;

        await supabase.from("issue_escalation_links").insert({
          issue_id: issue.id,
          conversation_session_id: data.id,
        });

        await supabase
          .from("conversation_sessions")
          .update({ linked_issue_id: issue.id })
          .eq("id", data.id);

        await supabase.from("tasks").insert({
          title: issueTitle,
          description: description || reason || null,
          department_id: escalationDepartmentId,
          priority: issuePriority,
          item_type: "issue",
          source: "whatsapp_agent",
          origin: "external",
          source_phone: phone,
        });

        try {
          const { logEscalationActivity } = await import("@/lib/escalation/activity");
          await logEscalationActivity({
            sessionId: data.id,
            issueId: issue.id,
            phoneE164: phone,
            action: "created_issue",
            actorLabel: "AI Agent",
            details: { title: issueTitle, priority: issuePriority },
          });
          await logEscalationActivity({
            sessionId: data.id,
            issueId: issue.id,
            phoneE164: phone,
            action: "linked_to_issue",
            actorLabel: "AI Agent",
          });
        } catch {
          // fire-and-forget
        }

        if (escalationDepartmentId) {
          void notifyDepartmentIssueContacts({
            issueId: issue.id,
            title: issueTitle,
            description: description || reason || null,
            departmentId: escalationDepartmentId,
          });
        }
      }
    } catch (err) {
      console.error("Issue/task creation during escalation failed:", err);
    }
  }

  // Notify escalation team members via email + WhatsApp. Best-effort: a
  // notification failure must never break the agent's reply.
  try {
    const { data: guest } = await supabase
      .from("whatsapp_users")
      .select("display_name")
      .eq("phone_e164", phone)
      .maybeSingle();

    await notifyEscalationTeam({
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
    issue_id: issueId,
    deduplicated,
    message:
      priority === "urgent"
        ? "Escalated to the support team as urgent. Reassure the user that someone will reach out right away."
        : "I've passed this on to our support team, and someone will follow up with you shortly.",
  });
}
