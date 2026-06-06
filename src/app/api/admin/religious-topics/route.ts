import { NextRequest, NextResponse } from "next/server";

import { canManageKnowledge } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { createReligiousTopic, listReligiousTopics } from "@/lib/knowledge/religious-topics";

export const runtime = "nodejs";
export const maxDuration = 120;

// GET: all religious topic blocks with content + entry/chunk counts.
export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, canManageKnowledge);
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json({ topics: await listReligiousTopics() });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to load" }, { status: 500 });
  }
}

// POST { title }: create a new (empty) religious topic block.
export async function POST(req: NextRequest) {
  const auth = await requirePortalCaller(req, canManageKnowledge);
  if (auth instanceof NextResponse) return auth;
  const body = (await req.json().catch(() => ({}))) as { title?: unknown };
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  try {
    const created = await createReligiousTopic(title);
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to create" }, { status: 500 });
  }
}
