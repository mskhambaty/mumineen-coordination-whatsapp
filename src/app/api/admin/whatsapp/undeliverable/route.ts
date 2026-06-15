import { NextRequest, NextResponse } from "next/server";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { normalizePhone, resolveRosterByPhone } from "@/lib/whatsapp/audience";
import { clearUndeliverable, listSuppressed } from "@/lib/whatsapp/undeliverable";

export const runtime = "nodejs";

// Undeliverable-number suppression list management. GET lists numbers auto-suppressed because Meta
// reported them as not-on-WhatsApp / can't-receive (with best-effort roster identity); DELETE
// un-flags one number so it's eligible for sends again. Exposes phone + name/ITS, so it is gated to
// admin/leadership only — the same level as the per-broadcast failures export.

// GET /api/admin/whatsapp/undeliverable — list currently-suppressed numbers with resolved identity.
export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, isAdminOrLeadership);
  if (auth instanceof NextResponse) return auth;

  const rows = await listSuppressed();
  const phones = [...new Set(rows.map((r) => r.phone_e164).filter(Boolean))];
  const rosterByPhone = phones.length > 0 ? await resolveRosterByPhone(phones) : new Map();

  const numbers = rows.map((r) => {
    const who = rosterByPhone.get(normalizePhone(r.phone_e164));
    return {
      phone: r.phone_e164,
      name: (who?.full_name as string | null) ?? null,
      its: (who?.its as string | null) ?? null,
      fail_count: r.fail_count,
      last_error_code: r.last_error_code,
      first_failed_at: r.first_failed_at,
      last_failed_at: r.last_failed_at,
      suppressed_at: r.suppressed_at,
    };
  });

  return NextResponse.json({ numbers });
}

// DELETE /api/admin/whatsapp/undeliverable?phone=+1... — un-flag a number (clears suppression and
// resets its failure counter so it's sendable again).
export async function DELETE(req: NextRequest) {
  const auth = await requirePortalCaller(req, isAdminOrLeadership);
  if (auth instanceof NextResponse) return auth;

  const phone = new URL(req.url).searchParams.get("phone")?.trim();
  if (!phone) return NextResponse.json({ error: "phone is required" }, { status: 400 });

  const clearedBy = auth.caller.user_id === "admin-api" ? null : auth.caller.user_id;
  const cleared = await clearUndeliverable(phone, clearedBy);
  if (!cleared) return NextResponse.json({ error: "Number is not on the suppression list" }, { status: 404 });

  return NextResponse.json({ cleared: true, phone: normalizePhone(phone) });
}
