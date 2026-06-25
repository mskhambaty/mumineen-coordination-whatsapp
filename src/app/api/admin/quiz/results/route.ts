import { NextRequest, NextResponse } from "next/server";

import { canMonitorReligiousChats } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getLeaderboard } from "@/lib/quiz/service";

export const runtime = "nodejs";

// Admin-only quiz leaderboard + summary. Same gate as the Waaz Talaqqi dashboard
// (admins/leadership or a religious monitor). Participants never see this — they only
// get their own score on the public page.
export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, canMonitorReligiousChats);
  if (auth instanceof NextResponse) return auth;
  const data = await getLeaderboard();
  return NextResponse.json(data);
}
