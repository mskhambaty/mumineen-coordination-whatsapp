import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { FEEDBACK_AREAS } from "@/lib/feedback/areas";
import { recordFeedback } from "@/lib/feedback/record";

export const runtime = "nodejs";

// Append-only feedback intake from the WhatsApp agent's submit_feedback tool. Identified by
// x-whatsapp-from; low-stakes like create_issue, so any identified caller may submit feedback
// about their own experience. One call may carry feedback for several areas.

const entrySchema = z.object({
  area: z.enum(FEEDBACK_AREAS),
  sentiment: z.enum(["positive", "neutral", "negative"]).nullish(),
  rating: z.number().int().min(1).max(5).nullish(),
  comment: z.string().max(2000).nullish(),
  raw_message: z.string().max(4000).nullish(),
});

const postSchema = z.object({ entries: z.array(entrySchema).min(1).max(10) });

export async function POST(req: NextRequest) {
  const phone = req.headers.get("x-whatsapp-from");
  if (!phone || !phone.trim()) {
    return NextResponse.json({ error: "Missing x-whatsapp-from header" }, { status: 400 });
  }

  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  }

  const result = await recordFeedback(
    phone.trim(),
    parsed.data.entries.map((e) => ({
      area: e.area,
      sentiment: e.sentiment ?? null,
      rating: e.rating ?? null,
      comment: e.comment ?? null,
      rawMessage: e.raw_message ?? null,
    })),
    { source: "whatsapp" },
  );

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ status: "ok", recorded: result.recorded });
}
