import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { resolveLostFoundReporter } from "@/lib/lost-found/reporter";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Public WhatsApp-agent intake. The caller is self-identified by x-whatsapp-from; the route stores
// only a report for that phone and exposes no reads or cross-user actions.
const reportSchema = z.object({
  report_type: z.enum(["lost", "found"]),
  item_name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(2000).nullish(),
  category: z.string().trim().max(120).nullish(),
  color: z.string().trim().max(120).nullish(),
  brand: z.string().trim().max(120).nullish(),
  location: z.string().trim().max(500).nullish(),
  occurred_at: z.string().datetime({ offset: true }).nullish(),
  reporter_name: z.string().trim().max(200).nullish(),
  reporter_its: z.string().trim().max(40).nullish(),
}).strict();

function appBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

async function escalateLostReport(
  phoneE164: string,
  report: z.infer<typeof reportSchema>,
  departmentName: string,
): Promise<"pending" | "failed"> {
  try {
    const details = [
      report.description,
      report.location ? `Last seen: ${report.location}` : null,
      report.color ? `Color: ${report.color}` : null,
      report.brand ? `Brand: ${report.brand}` : null,
    ].filter(Boolean).join("\n");
    const urgent = /\b(passport|wallet)\b/i.test(`${report.item_name} ${report.description ?? ""}`);
    const response = await fetch(`${appBaseUrl()}/api/escalations`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-whatsapp-from": phoneE164,
      },
      body: JSON.stringify({
        reason: `Lost item reported: ${report.item_name}`,
        title: `Lost item: ${report.item_name}`,
        description: details || `Lost ${report.item_name}`,
        priority: urgent ? "urgent" : "normal",
        category: "lost_found",
        department: departmentName,
        source: "ai",
      }),
    });
    const result = await response.json().catch(() => null) as { status?: string } | null;
    return response.ok && result?.status === "escalated" ? "pending" : "failed";
  } catch {
    return "failed";
  }
}

export async function POST(req: NextRequest) {
  const phone = req.headers.get("x-whatsapp-from")?.trim();
  if (!phone) {
    return NextResponse.json({ error: "Missing x-whatsapp-from header" }, { status: 400 });
  }

  const parsed = reportSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  }

  const reporter = await resolveLostFoundReporter(phone, {
    name: parsed.data.reporter_name,
    its: parsed.data.reporter_its,
  });
  if (!reporter.name) {
    return NextResponse.json(
      { error: "Reporter name is required when the sender is not linked to registration data" },
      { status: 400 },
    );
  }
  const supabase = getSupabaseAdmin();
  const { data: department } = await supabase
    .from("departments")
    .select("id, name")
    .ilike("name", "%Lost%Found%")
    .limit(1)
    .maybeSingle();
  await supabase
    .from("conversation_sessions")
    .update({ current_intent: "lost_found" })
    .eq("phone_e164", phone);
  const { data: report, error } = await supabase
    .from("lost_found_reports")
    .insert({
      report_type: parsed.data.report_type,
      item_name: parsed.data.item_name,
      description: parsed.data.description || null,
      category: parsed.data.category || null,
      color: parsed.data.color || null,
      brand: parsed.data.brand || null,
      location: parsed.data.location || null,
      occurred_at: parsed.data.occurred_at || null,
      department_id: department?.id ?? null,
      reporter_user_id: reporter.userId,
      reporter_mumin_id: reporter.muminId,
      reporter_name: reporter.name,
      reporter_phone_e164: reporter.phoneE164,
      reporter_its: reporter.its,
      escalation_status: parsed.data.report_type === "lost" ? "pending" : "not_required",
    })
    .select("id, report_type, created_at")
    .single();

  if (error || !report) {
    return NextResponse.json({ error: "Could not record lost-and-found report" }, { status: 500 });
  }

  let escalationStatus: "not_required" | "pending" | "failed" = "not_required";
  if (parsed.data.report_type === "lost") {
    escalationStatus = await escalateLostReport(phone, parsed.data, department?.name ?? "Lost and Found");
    await supabase
      .from("lost_found_reports")
      .update({
        escalation_status: escalationStatus,
        escalated_at: escalationStatus === "pending" ? new Date().toISOString() : null,
      })
      .eq("id", report.id);
  }

  return NextResponse.json({
    status: "recorded",
    report: { ...report, escalation_status: escalationStatus },
    help_desk_guidance: "Please go to any help desk in the masjid complex for drop-off or pickup.",
  }, { status: 201 });
}
