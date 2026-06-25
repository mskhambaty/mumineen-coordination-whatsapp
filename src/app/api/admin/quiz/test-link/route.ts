import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { canMonitorReligiousChats } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { createQuizRecipient } from "@/lib/quiz/service";

export const runtime = "nodejs";

const bodySchema = z.object({ display_name: z.string().max(120).optional() }).optional();

// Admin-only: mint a single TEST recipient + token and return the link, so the team can preview
// the live quiz end-to-end. Test recipients are flagged is_test=true and excluded from the
// leaderboard. The real audience broadcast (token-per-mumin + WhatsApp template) is a separate step.
export async function POST(req: NextRequest) {
  const auth = await requirePortalCaller(req, canMonitorReligiousChats);
  if (auth instanceof NextResponse) return auth;
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  const display_name = parsed.success ? parsed.data?.display_name : undefined;
  const { token, link } = await createQuizRecipient({ display_name: display_name ?? "Test", is_test: true });
  return NextResponse.json({ status: "ok", token, link });
}
