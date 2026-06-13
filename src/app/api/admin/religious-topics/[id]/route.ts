import { NextRequest, NextResponse } from "next/server";

import { canAccessPortal } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { deleteReligiousTopic, saveReligiousTopic } from "@/lib/knowledge/religious-topics";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

// PUT { content, updated_by }: save a religious topic block and re-index it.
export async function PUT(req: NextRequest, { params }: Ctx) {
  const auth = await requirePortalCaller(req, canAccessPortal);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    content?: unknown; updated_by?: unknown; source_url?: unknown; source_label?: unknown; theme?: unknown;
  };
  const content = typeof body.content === "string" ? body.content : "";
  const updatedBy = typeof body.updated_by === "string" ? body.updated_by.slice(0, 200) : null;
  const source =
    body.source_url !== undefined || body.source_label !== undefined
      ? {
          sourceUrl: typeof body.source_url === "string" ? body.source_url.trim() : null,
          sourceLabel: typeof body.source_label === "string" ? body.source_label.trim() : null,
        }
      : undefined;
  // Explicit theme string overrides auto-generation; omit the field to auto-generate.
  const theme = typeof body.theme === "string" ? body.theme.trim().slice(0, 160) : undefined;

  try {
    const result = await saveReligiousTopic(id, content, updatedBy, source, theme);
    return NextResponse.json({ id, ...result });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to save" }, { status: 500 });
  }
}

// DELETE: remove a religious topic block and its vectorized chunks.
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const auth = await requirePortalCaller(req, canAccessPortal);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  try {
    await deleteReligiousTopic(id);
    return NextResponse.json({ id, deleted: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to delete" }, { status: 500 });
  }
}
