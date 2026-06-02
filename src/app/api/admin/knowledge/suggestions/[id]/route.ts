import { NextRequest, NextResponse } from "next/server";

import { requireAdminKey } from "@/lib/api/auth";
import { saveFaqBucket } from "@/lib/knowledge/faq-buckets";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

type ActionBody = {
  action?: unknown;
  question?: unknown;
  answer?: unknown;
  reviewed_by?: unknown;
  department_id?: unknown;
};

// POST: approve (index into the knowledge base) or reject a suggestion.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as ActionBody;
  const action = body.action === "approve" || body.action === "reject" ? body.action : null;
  if (!action) {
    return NextResponse.json({ error: "action must be 'approve' or 'reject'" }, { status: 400 });
  }

  const reviewedBy = typeof body.reviewed_by === "string" ? body.reviewed_by.slice(0, 200) : null;
  const supabase = getSupabaseAdmin();

  const { data: suggestion, error: lookupError } = await supabase
    .from("knowledge_suggestions")
    .select("id, question, suggested_answer, status, department_id")
    .eq("id", id)
    .maybeSingle();

  if (lookupError || !suggestion) {
    return NextResponse.json({ error: "Suggestion not found" }, { status: 404 });
  }
  if (suggestion.status !== "pending") {
    return NextResponse.json({ error: "Suggestion has already been reviewed" }, { status: 409 });
  }

  if (action === "reject") {
    await supabase
      .from("knowledge_suggestions")
      .update({ status: "rejected", reviewed_by: reviewedBy, reviewed_at: new Date().toISOString() })
      .eq("id", id);
    return NextResponse.json({ id, status: "rejected" });
  }

  // Approve: append the (possibly edited) Q&A into the assigned department's FAQ bucket.
  const question = (typeof body.question === "string" ? body.question : suggestion.question).trim();
  const answer = (typeof body.answer === "string" ? body.answer : suggestion.suggested_answer).trim();
  if (!question || !answer) {
    return NextResponse.json({ error: "Question and answer are required to approve" }, { status: 400 });
  }

  const departmentId =
    (typeof body.department_id === "string" && body.department_id) || (suggestion.department_id as string | null);
  if (!departmentId) {
    return NextResponse.json({ error: "Assign a department before approving" }, { status: 400 });
  }

  try {
    // Append this Q&A to the department's existing bucket content, then re-index the bucket.
    const { data: bucket } = await supabase
      .from("faq_buckets")
      .select("content")
      .eq("department_id", departmentId)
      .maybeSingle();
    const prior = ((bucket?.content as string) ?? "").trim();
    const merged = [prior, `Q: ${question}\nA: ${answer}`].filter(Boolean).join("\n\n");
    const { chunk_count } = await saveFaqBucket(departmentId, merged, reviewedBy);

    await supabase
      .from("knowledge_suggestions")
      .update({
        status: "approved",
        department_id: departmentId,
        question,
        suggested_answer: answer,
        reviewed_by: reviewedBy,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", id);

    return NextResponse.json({ id, status: "approved", department_id: departmentId, chunk_count });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to index entry" }, { status: 500 });
  }
}
