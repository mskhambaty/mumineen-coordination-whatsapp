import { NextRequest, NextResponse } from "next/server";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { listMessageTemplates } from "@/lib/meta/whatsapp";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getAccounts } from "@/lib/whatsapp/accounts";
import { getTemplateSettings } from "@/lib/whatsapp/template-settings";
import { describeTemplate } from "@/lib/whatsapp/templates";

export const runtime = "nodejs";

// GET /api/admin/templates — data for the manual send console: the approved Meta templates
// (described, with our friendly-name + active annotations merged in) plus the committee/admin users
// selectable as a test audience. Returns the FULL catalog (active + inactive) so the page can both
// filter its dropdowns and drive the cleanup popup. Admin/leadership only. No PII (phone numbers) in
// the response; selectable users are id + name only.
export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, isAdminOrLeadership);
  if (auth instanceof NextResponse) return auth;

  // Across every WhatsApp account: its approved templates, tagged with the account/WABA/number that
  // owns them and merged with that account's own friendly-name / active settings (keyed per WABA).
  const perAccount = await Promise.all(
    getAccounts().map(async (account) => {
      const [tpls, settings] = await Promise.all([
        listMessageTemplates(account).catch(() => []),
        getTemplateSettings(account),
      ]);
      return tpls
        .filter((t) => t.status?.toUpperCase() === "APPROVED")
        .map((t) => {
          const desc = describeTemplate(t);
          const s = settings.get(desc.name);
          return {
            ...desc,
            friendlyName: s?.friendlyName ?? null,
            isActive: s?.isActive ?? true,
            accountLabel: account.label,
            wabaId: account.wabaId ?? null,
            phoneNumberId: account.phoneNumberId,
            displayNumber: account.displayNumber ?? null,
          };
        });
    }),
  );
  const templates = perAccount.flat();

  const { data: users } = await getSupabaseAdmin()
    .from("whatsapp_users")
    .select("id, display_name, role")
    .in("role", ["committee", "admin"])
    .eq("status", "active")
    .order("display_name", { ascending: true });

  return NextResponse.json({
    templates,
    selectable_users: ((users ?? []) as { id: string; display_name: string | null; role: string }[]).map((u) => ({
      id: u.id,
      name: u.display_name ?? "(no name)",
      role: u.role,
    })),
  });
}
