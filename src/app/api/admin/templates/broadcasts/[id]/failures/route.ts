import { NextRequest, NextResponse } from "next/server";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { normalizePhone, resolveRosterByPhone } from "@/lib/whatsapp/audience";
import { categorizeFailure } from "@/lib/whatsapp/broadcast";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

// GET /api/admin/templates/broadcasts/[id]/failures — the per-recipient failure list for one broadcast,
// so admins can follow up on undelivered messages. Returns phone + best-effort identity (name / ITS,
// resolved by phone) + the failure reason. This intentionally exposes PII, so it is gated to
// admin/leadership only — the same level as the audience CSV export — and is never shown to visitors.
// `?format=csv` returns a downloadable CSV; otherwise JSON.
const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePortalCaller(req, isAdminOrLeadership);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const supabase = getSupabaseAdmin();

  const { data: broadcast } = await supabase
    .from("template_broadcasts")
    .select("id, template_code")
    .eq("id", id)
    .maybeSingle();
  if (!broadcast) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: recips } = await supabase
    .from("template_broadcast_recipients")
    .select("phone_e164, error_detail, was_in_window")
    .eq("broadcast_id", id)
    .eq("send_status", "failed");
  const rows = (recips ?? []) as { phone_e164: string; error_detail: string | null; was_in_window: boolean | null }[];

  // Best-effort identity resolution by phone (a failed number may not match a roster row). Uses the
  // shared roster resolver so it picks up names via mumin_phone_links (shared/registration numbers),
  // not just a direct whatsapp_e164 match — so the Name/ITS columns populate far more often.
  const phones = [...new Set(rows.map((r) => r.phone_e164).filter(Boolean))];
  const rosterByPhone = phones.length > 0 ? await resolveRosterByPhone(phones) : new Map();

  const failures = rows.map((r) => {
    const who = rosterByPhone.get(normalizePhone(r.phone_e164));
    return {
      phone: r.phone_e164,
      name: (who?.full_name as string | null) ?? null,
      its: (who?.its as string | null) ?? null,
      was_in_window: r.was_in_window,
      reason: categorizeFailure(r.error_detail, r.was_in_window),
    };
  });

  if (new URL(req.url).searchParams.get("format") === "csv") {
    const header = ["Name", "ITS", "WhatsApp", "Window", "Reason"];
    const lines = [header.map(esc).join(",")];
    for (const f of failures) {
      lines.push([f.name, f.its, f.phone, f.was_in_window ? "free" : "paid", f.reason].map(esc).join(","));
    }
    // Prepend a BOM so Excel reads UTF-8 names correctly.
    const csv = "﻿" + lines.join("\r\n");
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="failures-${broadcast.template_code}-${id.slice(0, 8)}.csv"`,
      },
    });
  }

  return NextResponse.json({ failures });
}
