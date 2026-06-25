import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { loadQuizForToken, recordQuizResponse } from "@/lib/quiz/service";

export const runtime = "nodejs";

// Public, token-scoped quiz. The opaque per-recipient token in the path identifies the taker — no
// portal/ITS auth. GET returns the bilingual quiz (+ first name to greet); POST grades + records the
// attempt (idempotent). No PII beyond the first name is ever returned.

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 8) return NextResponse.json({ status: "not_found" }, { status: 404 });
  const quiz = await loadQuizForToken(token);
  if (quiz.status === "not_found") return NextResponse.json({ status: "not_found" }, { status: 404 });
  return NextResponse.json(quiz);
}

const bodySchema = z.object({
  answers: z
    .array(
      z.object({
        question_id: z.string().min(1).max(40),
        chosen_index: z.number().int().min(0).max(9).nullable(),
      }),
    )
    .min(1)
    .max(100),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 8) return NextResponse.json({ error: "Invalid quiz link." }, { status: 404 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  }

  const result = await recordQuizResponse(token, parsed.data.answers);
  if ("error" in result) return NextResponse.json(result, { status: 400 });
  return NextResponse.json(result);
}
