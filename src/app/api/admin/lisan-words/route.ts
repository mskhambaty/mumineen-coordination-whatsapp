import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { canAccessPortal } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import {
  addLisanWord,
  countLisanWords,
  importLisanWords,
  listAllLisanWords,
  type LisanImportRow,
} from "@/lib/knowledge/lisan-words";
import { parseCsv } from "@/lib/util/csv";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_FILE_BYTES = 15 * 1024 * 1024;

// Quote a CSV cell only when needed (comma, quote, or newline); double internal quotes.
function csvCell(value: string | null): string {
  const s = value ?? "";
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// GET: how many words are currently loaded (default), or `?format=csv` to download the whole
// dictionary as a re-importable CSV (backup / master). DB is the source of truth.
export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, canAccessPortal);
  if (auth instanceof NextResponse) return auth;
  try {
    if (req.nextUrl.searchParams.get("format") === "csv") {
      const words = await listAllLisanWords();
      const header = "transliteration,lisan,meaning,example";
      const body = words
        .map((w) => [w.transliteration, w.lisan, w.meaning, w.example].map(csvCell).join(","))
        .join("\n");
      return new NextResponse(`${header}\n${body}\n`, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="lisan-dictionary.csv"',
        },
      });
    }
    return NextResponse.json({ count: await countLisanWords() });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}

// PUT: add (or update) ONE word — the day-to-day path for filling a dictionary gap without a
// full CSV re-upload. The DB is the source of truth; dedupe on the normalized word.
const addWordSchema = z.object({
  transliteration: z.string().trim().max(200).optional().default(""),
  lisan: z.string().trim().max(200).optional().default(""),
  meaning: z.string().trim().max(1000).optional().default(""),
  example: z.string().trim().max(2000).optional().default(""),
});

export async function PUT(req: NextRequest) {
  const auth = await requirePortalCaller(req, canAccessPortal);
  if (auth instanceof NextResponse) return auth;

  const json = await req.json().catch(() => null);
  const parsed = addWordSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { transliteration, lisan } = parsed.data;
  if (!transliteration && !lisan) {
    return NextResponse.json(
      { error: "Provide at least a transliteration or a Lisan word." },
      { status: 422 },
    );
  }

  try {
    const result = await addLisanWord(parsed.data);
    if (result.status === "invalid") {
      return NextResponse.json({ error: "Word has no usable text." }, { status: 422 });
    }
    return NextResponse.json(result, { status: result.status === "added" ? 201 : 200 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Add failed" }, { status: 500 });
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
  const auth = await requirePortalCaller(req, canAccessPortal);
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
