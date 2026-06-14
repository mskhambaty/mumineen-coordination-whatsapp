import { NextRequest, NextResponse } from "next/server";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { normalizePhone, resolveRosterByPhone } from "@/lib/whatsapp/audience";
import { categorizeFailure } from "@/lib/whatsapp/broadcast";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

// GET /api/admin/templates/broadcasts/[id]/recipients — the FULL audience a broadcast sent to: every
// recipient with its send status (sent/failed/skipped/queued/delivered/read/replied), window flag,
// and best-effort identity (name / ITS resolved by phone). The per-recipient failure reason is
// included for failed rows. Like /failures this intentionally exposes PII, so it is gated to
// admin/leadership only and never shown to visitors. `?format=csv` returns a downloadable CSV.
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
    .select("phone_e164, send_status, error_detail, skip_reason, was_in_window, sent_at")
    .eq("broadcast_id", id)
    .order("send_status", { ascending: true });
  const rows = (recips ?? []) as {
    phone_e164: string;
    send_status: string;
    error_detail: string | null;
    skip_reason: string | null;
    was_in_window: boolean | null;
    sent_at: string | null;
  }[];

  // Best-effort identity resolution by phone, via the shared resolver (picks up names through
  // mumin_phone_links, not just a direct whatsapp_e164 match).
  const phones = [...new Set(rows.map((r) => r.phone_e164).filter(Boolean))];
  const rosterByPhone = phones.length > 0 ? await resolveRosterByPhone(phones) : new Map();

  const recipients = rows.map((r) => {
    const who = rosterByPhone.get(normalizePhone(r.phone_e164));
    return {
      phone: r.phone_e164,
      name: (who?.full_name as string | null) ?? null,
      its: (who?.its as string | null) ?? null,
      status: r.send_status,
      was_in_window: r.was_in_window,
      sent_at: r.sent_at,
      detail: r.send_status === "failed" ? categorizeFailure(r.error_detail, r.was_in_window) : (r.skip_reason ?? null),
    };
  });

  if (new URL(req.url).searchParams.get("format") === "csv") {
    const header = ["Name", "ITS", "WhatsApp", "Status", "Window", "Sent at", "Detail"];
    const lines = [header.map(esc).join(",")];
    for (const r of recipients) {
      lines.push([r.name, r.its, r.phone, r.status, r.was_in_window ? "free" : "paid", r.sent_at, r.detail].map(esc).join(","));
    }
    // Prepend a BOM so Excel reads UTF-8 names correctly.
    const csv = "﻿" + lines.join("\r\n");
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="audience-${broadcast.template_code}-${id.slice(0, 8)}.csv"`,
      },
    });
  }

  return NextResponse.json({ recipients });
}
