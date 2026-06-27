import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { canMonitorReligiousChats } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getQuizShare, setQuizOpen } from "@/lib/quiz/service";

export const runtime = "nodejs";

// Admin-only: the quiz's shared public link + open/close switch. GET returns { link, is_open };
// POST { is_open } opens or closes the quiz (closing makes the shared link stop accepting attempts).
export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, canMonitorReligiousChats);
  if (auth instanceof NextResponse) return auth;
  const share = await getQuizShare();
  if (!share) return NextResponse.json({ error: "Quiz not found." }, { status: 404 });
  return NextResponse.json({ status: "ok", ...share });
}

const bodySchema = z.object({ is_open: z.boolean() });

export async function POST(req: NextRequest) {
  const auth = await requirePortalCaller(req, canMonitorReligiousChats);
  if (auth instanceof NextResponse) return auth;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  await setQuizOpen(parsed.data.is_open);
  const share = await getQuizShare();
  return NextResponse.json({ status: "ok", ...share });
}
