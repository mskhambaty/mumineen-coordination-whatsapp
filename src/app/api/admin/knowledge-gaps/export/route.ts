import * as XLSX from "xlsx";
import { NextRequest, NextResponse } from "next/server";

import { requireAdminKey } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

type Gap = {
  topic: string;
  sample_question: string | null;
};

// POST /api/admin/knowledge-gaps/export
//
// Accepts an optional multipart form field `reference` (an .xlsx file of the
// previously exported sheet). Returns an Excel file containing only gaps whose
// (topic, question) pair does NOT already appear in the reference sheet —
// i.e. net-new gaps ready to be pasted into Google Sheets.
//
// If no reference file is uploaded, all open gaps are exported.
export async function POST(req: NextRequest) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Load open gaps from Supabase.
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("knowledge_gaps")
    .select("topic, sample_question, times_seen, last_seen_at")
    .eq("status", "open")
    .order("times_seen", { ascending: false })
    .order("last_seen_at", { ascending: false })
    .limit(2000);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const gaps = (data ?? []) as Gap[];

  // Parse the reference file if one was uploaded.
  const existingKeys = await parseReferenceKeys(req);

  // Filter out gaps already in the reference sheet.
  const netNew = existingKeys.size > 0
    ? gaps.filter((g) => !existingKeys.has(dedupeKey(g.topic, g.sample_question ?? "")))
    : gaps;

  // Build Excel output.
  const rows = [
    ["topic", "question", "answer", "department"],
    ...netNew.map((g) => [g.topic, g.sample_question ?? "", "", ""]),
  ];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Set column widths for readability.
  ws["!cols"] = [{ wch: 30 }, { wch: 60 }, { wch: 80 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, ws, "Knowledge Gaps");

  const rawBuffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const buffer = Buffer.isBuffer(rawBuffer) ? rawBuffer : Buffer.from(rawBuffer as Uint8Array);

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="knowledge-gaps-${datestamp()}.xlsx"`,
    },
  });
}

// Build a normalized dedup key from topic + question.
function dedupeKey(topic: string, question: string): string {
  return `${normalize(topic)}||${normalize(question)}`;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function datestamp(): string {
  return new Date().toISOString().slice(0, 10);
}

// Parse the uploaded reference Excel and return a Set of dedup keys.
async function parseReferenceKeys(req: NextRequest): Promise<Set<string>> {
  const keys = new Set<string>();
  try {
    const form = await req.formData().catch(() => null);
    const file = form?.get("reference");
    if (!(file instanceof File) || file.size === 0) return keys;

    const buffer = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buffer, { type: "buffer" });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) return keys;

    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(wb.Sheets[sheetName], { defval: "" });
    for (const row of rows) {
      const topic = String(row["topic"] ?? row["Topic"] ?? "").trim();
      const question = String(row["question"] ?? row["Question"] ?? "").trim();
      if (topic) keys.add(dedupeKey(topic, question));
    }
  } catch {
    // If parsing fails, treat as no reference — export everything.
  }
  return keys;
}
