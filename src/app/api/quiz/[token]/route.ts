import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { loadQuizForToken, recordQuizResponse, recordSelfIdentified } from "@/lib/quiz/service";

export const runtime = "nodejs";

// Public, token-scoped quiz. The path segment is EITHER a per-recipient token (admin test links) OR
// the quiz's shared share_token (the link everyone gets). No portal/ITS auth. GET returns the
// bilingual quiz; for the shared link it sets requires_identity so the page collects ITS + name.
// POST grades + records the attempt (idempotent). PII (ITS) is accepted, stored, and never logged.

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 8) return NextResponse.json({ status: "not_found" }, { status: 404 });
  const quiz = await loadQuizForToken(token);
  if (quiz.status === "not_found") return NextResponse.json({ status: "not_found" }, { status: 404 });
  return NextResponse.json(quiz);
}

const answersSchema = z
  .array(
    z.object({
      question_id: z.string().min(1).max(40),
      chosen_index: z.number().int().min(0).max(9).nullable(),
    }),
  )
  .min(1)
  .max(100);

// Recipient (test-link) submit.
const recipientSchema = z.object({ answers: answersSchema });
// Shared-link submit: the taker self-identifies with ITS + name, and we capture timing.
const selfIdSchema = z.object({
  its_number: z.string().regex(/^\d{8}$/, "ITS must be 8 digits"),
  name: z.string().trim().min(1).max(80),
  duration_seconds: z.number().int().min(0).max(36000),
  time_taken_seconds: z.number().int().min(0).max(86400),
  answers: answersSchema,
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 8) return NextResponse.json({ error: "Invalid quiz link." }, { status: 404 });

  const raw = await req.json().catch(() => null);

  // Shared-link self-identified submit (body carries an ITS number).
  if (raw && typeof raw === "object" && "its_number" in raw) {
    const parsed = selfIdSchema.safeParse(raw);
    if (!parsed.success) return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
    const result = await recordSelfIdentified({ share_token: token, ...parsed.data });
    if ("error" in result) return NextResponse.json(result, { status: 400 });
    return NextResponse.json(result);
  }

  // Recipient (test-link) submit.
  const parsed = recipientSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  const result = await recordQuizResponse(token, parsed.data.answers);
  if ("error" in result) return NextResponse.json(result, { status: 400 });
  return NextResponse.json(result);
}
