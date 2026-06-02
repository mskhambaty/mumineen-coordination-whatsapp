import { NextRequest, NextResponse } from "next/server";

import { requireAdminKey } from "@/lib/api/auth";
import { saveFaqBucket } from "@/lib/knowledge/faq-buckets";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ departmentId: string }> };

// PUT { content, updated_by }: save a department's FAQ bucket and re-index it.
export async function PUT(req: NextRequest, { params }: Ctx) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { departmentId } = await params;
  const body = (await req.json().catch(() => ({}))) as { content?: unknown; updated_by?: unknown };
  const content = typeof body.content === "string" ? body.content : "";
  const updatedBy = typeof body.updated_by === "string" ? body.updated_by.slice(0, 200) : null;

  try {
    const result = await saveFaqBucket(departmentId, content, updatedBy);
    return NextResponse.json({ department_id: departmentId, ...result });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to save" }, { status: 500 });
  }
}
