import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { loadFormForToken, recordSurveyResponse } from "@/lib/surveys/respond";

export const runtime = "nodejs";

// Public, token-scoped survey collection. The opaque per-recipient token in the path identifies
// the mumin + form — no portal/ITS auth. GET returns the form (+ responder first name to confirm);
// POST records answers (idempotent). No PII beyond the first name is ever returned.

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 8) return NextResponse.json({ status: "not_found" }, { status: 404 });
  const form = await loadFormForToken(token);
  if (form.status === "not_found") return NextResponse.json({ status: "not_found" }, { status: 404 });
  return NextResponse.json(form);
}

const bodySchema = z.object({
  answers: z
    .array(
      z.object({
        question_id: z.string().uuid(),
        value: z.string().max(2000).nullable(),
        reason: z.string().max(2000).nullable().optional(),
      }),
    )
    .min(1)
    .max(200),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 8) return NextResponse.json({ error: "Invalid survey link." }, { status: 404 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  }

  const result = await recordSurveyResponse(token, parsed.data.answers);
  if ("error" in result) return NextResponse.json(result, { status: 400 });
  return NextResponse.json({ status: "ok", recorded: result.recorded });
}
