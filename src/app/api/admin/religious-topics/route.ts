import { NextRequest, NextResponse } from "next/server";

import { canAccessPortal } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import {
  createReligiousTopic,
  listReligiousTopics,
  type ReligiousCategory,
  type ReligiousLanguage,
  type ReligiousStatus,
} from "@/lib/knowledge/religious-topics";

const CATEGORIES = ["reflection", "tazyeen", "al_dars", "jumla", "kalema", "unwaan", "misc"];
const LANGUAGES = ["en", "lisan"];
const STATUSES = ["indexed", "pending_translation", "placeholder"];

export const runtime = "nodejs";
export const maxDuration = 120;

// GET: all religious topic blocks with content + entry/chunk counts.
export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, canAccessPortal);
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json({ topics: await listReligiousTopics() });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to load" }, { status: 500 });
  }
}

// POST { title, ...metadata }: create a new (empty) religious topic block. The Ashara
// dashboard passes per-majlis metadata (year/majlis/category/language/status/source).
export async function POST(req: NextRequest) {
  const auth = await requirePortalCaller(req, canAccessPortal);
  if (auth instanceof NextResponse) return auth;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const oneOf = <T extends string>(v: unknown, allow: string[]) =>
    typeof v === "string" && allow.includes(v) ? (v as T) : undefined;

  try {
    const created = await createReligiousTopic(title, {
      yearHijri: str(body.year_hijri) ?? null,
      majlisNumber: typeof body.majlis_number === "number" ? body.majlis_number : null,
      isAshura: typeof body.is_ashura === "boolean" ? body.is_ashura : undefined,
      category: oneOf<ReligiousCategory>(body.category, CATEGORIES) ?? null,
      language: oneOf<ReligiousLanguage>(body.language, LANGUAGES),
      status: oneOf<ReligiousStatus>(body.status, STATUSES),
      sourceUrl: str(body.source_url) ?? null,
      sourceLabel: str(body.source_label) ?? null,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to create" }, { status: 500 });
  }
}
