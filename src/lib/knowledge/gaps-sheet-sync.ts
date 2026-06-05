import { chunkText, indexChunksForPage } from "@/lib/knowledge/index-content";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { optionalEnv } from "@/lib/env";

export const GAPS_SHEET_PAGE_URL_PREFIX = "faqsheet://";

// Deterministic page_url for a sheet row, keyed by topic + question.
export function gapsSheetPageUrl(topic: string, question: string): string {
  return `${GAPS_SHEET_PAGE_URL_PREFIX}${slugify(topic)}/${slugify(question)}`;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/^_|_$/g, "")
    .slice(0, 80);
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

type SheetRow = {
  topic: string;
  question: string;
  answer: string;
  department: string;
};

// Parse a CSV string (Google Sheets export) into rows.
// Expects columns in order: topic, question, answer, department
// Skips the header row and any row where answer is blank.
export function parseGapsSheetCsv(csv: string): SheetRow[] {
  const rows = parseCsv(csv);
  if (rows.length < 2) return [];

  // Find column indices from header row (case-insensitive)
  const header = rows[0].map((h) => h.toLowerCase().trim());
  const topicIdx = header.indexOf("topic");
  const questionIdx = header.indexOf("question");
  const answerIdx = header.indexOf("answer");
  const departmentIdx = header.indexOf("department");

  // Fall back to positional (topic=0, question=1, answer=2, department=3)
  const tIdx = topicIdx >= 0 ? topicIdx : 0;
  const qIdx = questionIdx >= 0 ? questionIdx : 1;
  const aIdx = answerIdx >= 0 ? answerIdx : 2;
  const dIdx = departmentIdx >= 0 ? departmentIdx : 3;

  return rows
    .slice(1)
    .map((row) => ({
      topic: (row[tIdx] ?? "").trim(),
      question: (row[qIdx] ?? "").trim(),
      answer: (row[aIdx] ?? "").trim(),
      department: (row[dIdx] ?? "").trim(),
    }))
    .filter((r) => r.topic && r.answer);
}

// Fetch, parse, and index answered rows from the configured Google Sheet CSV URL.
// Returns stats: { synced, updated, skipped, errors }
export async function syncGapsFromSheet(): Promise<{
  synced: number;
  updated: number;
  skipped: number;
  errors: number;
}> {
  const sheetUrl = optionalEnv("GAPS_SHEET_CSV_URL");
  if (!sheetUrl) {
    console.log("GAPS_SHEET_CSV_URL not set — skipping gaps sheet sync.");
    return { synced: 0, updated: 0, skipped: 0, errors: 0 };
  }

  const res = await fetch(sheetUrl);
  if (!res.ok) throw new Error(`Failed to fetch gaps sheet: ${res.status}`);
  const csv = await res.text();

  const rows = parseGapsSheetCsv(csv);
  if (rows.length === 0) {
    console.log("Gaps sheet has no answered rows.");
    return { synced: 0, updated: 0, skipped: 0, errors: 0 };
  }

  const supabase = getSupabaseAdmin();
  let synced = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of rows) {
    const pageUrl = gapsSheetPageUrl(row.topic, row.question);
    const content = buildContent(row);

    try {
      // Check if we already have this row indexed with identical content.
      const { data: existing } = await supabase
        .from("site_content")
        .select("content")
        .eq("page_url", pageUrl)
        .eq("is_current", true)
        .maybeSingle();

      if (existing && normalize(existing.content as string) === normalize(content)) {
        skipped++;
        continue;
      }

      const isUpdate = !!existing;
      await indexChunksForPage(pageUrl, row.topic, chunkText(content));

      if (isUpdate) {
        updated++;
      } else {
        synced++;
      }
    } catch (err) {
      console.error(`Failed to index gap "${row.topic}":`, err);
      errors++;
    }
  }

  console.log(`Gaps sheet sync: ${synced} new, ${updated} updated, ${skipped} unchanged, ${errors} errors`);
  return { synced, updated, skipped, errors };
}

function buildContent(row: SheetRow): string {
  const lines = [`Q: ${row.question}`, `A: ${row.answer}`];
  if (row.department) lines.push(`Department: ${row.department}`);
  return lines.join("\n");
}

// Minimal CSV parser (same logic as scrape-site.ts).
function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    const next = csv[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') { field += '"'; i++; }
      else inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) { row.push(field); field = ""; continue; }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i++;
      row.push(field);
      if (row.some((c) => c.trim())) rows.push(row);
      row = []; field = "";
      continue;
    }
    field += char;
  }

  row.push(field);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}
