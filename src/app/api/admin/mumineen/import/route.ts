import { NextRequest, NextResponse } from "next/server";

import { requireAdminKey } from "@/lib/api/auth";
import { importMumineenRoster } from "@/lib/mumineen/import";

export const runtime = "nodejs";
// Importing ~4k rows (upserts + finalize) can take a while.
export const maxDuration = 300;

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB

// POST: import the mumineen roster from an uploaded Excel/CSV. Idempotent (upsert).
export async function POST(req: NextRequest) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "A roster file (.xlsx/.xls) is required" }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "File is too large (max 25 MB)" }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await importMumineenRoster(buffer);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Import failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
