import { NextRequest, NextResponse } from "next/server";

import { canAccessMumineen } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { importMumineenRoster } from "@/lib/mumineen/import";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
// Importing ~4k rows (upserts + finalize) can take a while.
export const maxDuration = 300;

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB

// POST: import the mumineen roster from an uploaded Excel/CSV. Idempotent (upsert).
export async function POST(req: NextRequest) {
  const auth = await requirePortalCaller(req, canAccessMumineen);
  if (auth instanceof NextResponse) return auth;

  // Server-to-server (admin-key) callers have the sentinel id; record null for them.
  const uploaderUserId = auth.caller.user_id === "admin-api" ? null : auth.caller.user_id;
  const uploaderName = req.headers.get("x-admin-user-name") ?? null;

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "A roster file (.xlsx/.xls) is required" }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "File is too large (max 25 MB)" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  let result;

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    result = await importMumineenRoster(buffer);

    await supabase.from("mumineen_import_log").insert({
      imported_by_user_id: uploaderUserId,
      imported_by_name: uploaderName,
      file_name: file.name,
      file_size_bytes: file.size,
      rows_in_file: result.rows,
      families_upserted: result.families,
      mumineen_upserted: result.mumineen,
      deactivated_missing: result.deactivatedMissing,
      auto_columns: result.autoColumns,
      status: "success",
    });

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Import failed";

    await supabase.from("mumineen_import_log").insert({
      imported_by_user_id: uploaderUserId,
      imported_by_name: uploaderName,
      file_name: file.name,
      file_size_bytes: file.size,
      rows_in_file: null,
      families_upserted: null,
      mumineen_upserted: null,
      deactivated_missing: null,
      auto_columns: null,
      status: "error",
      error_message: message,
    });

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET: import history log.
export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, canAccessMumineen);
  if (auth instanceof NextResponse) return auth;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("mumineen_import_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
