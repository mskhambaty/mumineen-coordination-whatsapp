import { NextRequest, NextResponse } from "next/server";

import { canManageKnowledge } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { countLisanWords, importLisanWords, type LisanImportRow } from "@/lib/knowledge/lisan-words";
import { parseCsv } from "@/lib/util/csv";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_FILE_BYTES = 15 * 1024 * 1024;

// GET: how many words are currently loaded.
export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, canManageKnowledge);
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json({ count: await countLisanWords() });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}

// Find a column index whose header matches any of the candidate substrings.
function findCol(headers: string[], ...candidates: string[]): number {
  const lower = headers.map((h) => h.trim().toLowerCase());
  for (const cand of candidates) {
    const i = lower.findIndex((h) => h.includes(cand));
    if (i !== -1) return i;
  }
  return -1;
}

// POST: upload the dictionary CSV (full replace). Expected columns (by header):
// transliteration/word, lisan, meaning, example.
export async function POST(req: NextRequest) {
  const auth = await requirePortalCaller(req, canManageKnowledge);
  if (auth instanceof NextResponse) return auth;

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "A CSV file is required" }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "File is too large (max 15 MB)" }, { status: 400 });
  }

  try {
    const csv = Buffer.from(await file.arrayBuffer()).toString("utf8");
    const rows = parseCsv(csv);
    if (rows.length < 2) {
      return NextResponse.json({ error: "CSV has no data rows" }, { status: 422 });
    }

    const headers = rows[0];
    const tCol = findCol(headers, "translit", "word");
    const lCol = findCol(headers, "lisan");
    const mCol = findCol(headers, "meaning");
    const eCol = findCol(headers, "example", "sentence");
    if (tCol === -1 && lCol === -1) {
      return NextResponse.json(
        { error: "CSV must have a transliteration/word or lisan column." },
        { status: 422 },
      );
    }

    const importRows: LisanImportRow[] = rows.slice(1).map((r) => ({
      transliteration: tCol !== -1 ? r[tCol] : null,
      lisan: lCol !== -1 ? r[lCol] : null,
      meaning: mCol !== -1 ? r[mCol] : null,
      example: eCol !== -1 ? r[eCol] : null,
    }));

    const inserted = await importLisanWords(importRows);
    return NextResponse.json({ status: "imported", count: inserted }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Import failed" }, { status: 500 });
  }
}
