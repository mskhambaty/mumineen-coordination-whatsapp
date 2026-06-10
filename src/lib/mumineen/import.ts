import * as XLSX from "xlsx";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { normalizeWhatsAppPhone } from "@/lib/whatsapp/parser";

export type RosterImportResult = {
  rows: number;
  families: number;
  mumineen: number;
  // Column names auto-mapped from the sheet because they matched a mumineen DB column
  // (i.e. not part of the explicit friendly-header map). Useful as import feedback.
  autoColumns: string[];
  // false when this was an additive import (a new batch sharing no ITS with existing
  // records): the existing roster was preserved instead of soft-deactivating missing rows.
  deactivatedMissing: boolean;
};

type Row = Record<string, unknown>;
type Supabase = ReturnType<typeof getSupabaseAdmin>;
type Parse = (v: unknown) => unknown;

const text = (v: unknown): string | null => (v == null ? null : String(v).trim() || null);
const intOrNull = (v: unknown): number | null => {
  const s = text(v);
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};
const genderOf = (v: unknown): "M" | "F" | null => {
  const g = text(v);
  return g === "M" || g === "F" ? g : null;
};
const yesNo = (v: unknown): boolean | null => {
  const s = text(v);
  return s == null ? null : /^y(es)?$/i.test(s);
};

// Normalize a roster phone cell to E.164 (+<countrycode><national>), matching the exact format the
// WhatsApp webhook produces for inbound numbers (normalizeWhatsAppPhone) so the stored value is
// ready to link to senders. Blank → null.
//
// A leading + means the cell already carries its country code — trust it verbatim and never inject
// one. (Previously the + was stripped and any 10-digit result re-prefixed with +1, which mangled
// 10-digit international numbers, e.g. Singapore +65········ became +1 65········.) For bare digit
// strings a 10-digit number is assumed local US (Chicago jamaat) and gets +1; longer strings are
// assumed to already include their country code. NOTE: a bare 10-digit *international* number is
// indistinguishable from a US one here — enter those with a leading + in the roster.
export const rosterPhoneToE164 = (v: unknown): string | null => {
  const s = text(v);
  if (!s) return null;
  const hasPlus = s.trimStart().startsWith("+");
  const digits = s.replace(/\D/g, "");
  if (!digits) return null;
  if (hasPlus) return normalizeWhatsAppPhone(digits);
  return normalizeWhatsAppPhone(digits.length === 10 ? `1${digits}` : digits);
};

// Explicit map for columns whose Excel header differs from the DB column name, or that need
// typed parsing. Identity columns (its/hof_its) and import-managed flags (family_id, is_head,
// roster_active) are handled separately. Any other (non-protected) mumineen column is
// auto-mapped at runtime when the sheet provides a header matching the column name exactly.
const EXPLICIT_MAP: { header: string; col: string; parse: Parse }[] = [
  { header: "Fullname", col: "full_name", parse: text },
  { header: "Gender", col: "gender", parse: genderOf },
  { header: "Age", col: "age", parse: intOrNull },
  { header: "Jamaat", col: "jamaat", parse: text },
  { header: "Idara", col: "idara", parse: text },
  { header: "Category", col: "category", parse: text },
  { header: "Prefix", col: "prefix", parse: text },
  { header: "Title", col: "title", parse: text },
  { header: "Venue (Waaz)", col: "venue", parse: text },
  { header: "City", col: "city", parse: text },
  { header: "Local/Mehman", col: "local_mehman", parse: text },
  { header: "Arr Place Date", col: "roster_arrival_raw", parse: text },
  { header: "Flight Code", col: "roster_flight_code", parse: text },
  { header: "Daily Trans", col: "daily_trans", parse: text },
  { header: "Whatsapp Link Clicked?", col: "whatsapp_link_clicked", parse: yesNo },
  { header: "whatsapp_e164", col: "whatsapp_e164", parse: rosterPhoneToE164 },
];

// Columns the importer must never write: structural/system identity and registration-collected
// fields (filled in by mumineen themselves; a roster import must not clobber them). Everything
// else on the table is eligible for auto-mapping. NOTE: email auto-maps from its same-named sheet
// header; whatsapp_e164 is import-owned too but mapped via EXPLICIT_MAP so it gets E.164
// normalization (rosterPhoneToE164) instead of the plain text parser.
const PROTECTED_COLUMNS = new Set([
  "id",
  "its",
  "hof_its",
  "family_id",
  "is_head",
  "roster_active",
  "created_at",
  "updated_at",
  // registration-collected
  "arrival_at",
  "arrival_flight_no",
  "departure_at",
  "departure_flight_no",
  "rahat_seating",
  "wheelchair",
  "special_needs",
  "airport",
  "not_attending",
  "wants_khidmat",
  "khidmat_department_ids",
]);

// Pick a parser for an auto-mapped column by its Postgres data type. Returns null for types
// we won't risk auto-coercing (timestamps, arrays, uuid, json, …); such columns are skipped.
function parserForType(dataType: string): Parse | null {
  if (dataType === "boolean") return yesNo;
  if (dataType === "integer" || dataType === "bigint" || dataType === "smallint") return intOrNull;
  if (dataType === "text" || dataType === "character varying") return text;
  return null;
}

async function chunkUpsert(supabase: Supabase, table: string, rows: Row[], onConflict: string, size = 500) {
  for (let i = 0; i < rows.length; i += size) {
    const { error } = await supabase.from(table).upsert(rows.slice(i, i + size), { onConflict });
    if (error) throw new Error(`${table} upsert failed: ${error.message}`);
  }
}

// Import the mumineen roster from the Excel. Idempotent: upserts families on hof_its and
// mumineen on its, updating only import-owned columns (registration-
// collected columns are never in the payload, so they're preserved). Column mapping is
// data-driven: the explicit friendly-header map plus any sheet header matching a non-protected
// mumineen column name (so new roster columns are picked up with no code change). Blank-safe: a
// missing/blank cell keeps the previously stored value (new ?? existing). The finalize RPC sets
// head linkage and, for non-additive imports, soft-deactivates rows missing from the file.
export async function importMumineenRoster(buffer: Buffer): Promise<RosterImportResult> {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<Row>(ws, { defval: null });
  // Real data rows always have BOTH a Mumin Id and a Hof Id. This drops the banner row
  // (no Mumin Id) and the "Count Distinct" footer total (a Mumin Id count but no Hof Id).
  const rows = raw.filter((r) => r["Mumin Id"] != null && text(r["Hof Id"]) != null);
  if (rows.length === 0) {
    throw new Error("No mumineen rows found. The sheet must have 'Mumin Id' and 'Hof Id' columns.");
  }

  const supabase = getSupabaseAdmin();

  // Collect every header present across the sheet rows.
  const headers = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) headers.add(k);

  // Build the active column mapping: explicit headers present in the sheet, plus any sheet
  // header that matches a non-protected mumineen column name (auto-mapped by data type).
  const { data: colData, error: colErr } = await supabase.rpc("get_mumineen_columns");
  if (colErr) throw new Error(`column introspection failed: ${colErr.message}`);
  const dbCols = (colData ?? []) as { column_name: string; data_type: string }[];

  const explicitCols = new Set(EXPLICIT_MAP.map((e) => e.col));
  const mappings: { header: string; col: string; parse: Parse }[] = EXPLICIT_MAP.filter((e) =>
    headers.has(e.header),
  );
  const autoColumns: string[] = [];
  for (const c of dbCols) {
    if (PROTECTED_COLUMNS.has(c.column_name)) continue;
    if (explicitCols.has(c.column_name)) continue;
    if (!headers.has(c.column_name)) continue; // sheet must provide a matching header
    const parse = parserForType(c.data_type);
    if (!parse) continue;
    mappings.push({ header: c.column_name, col: c.column_name, parse });
    autoColumns.push(c.column_name);
  }
  const targetCols = [...new Set(mappings.map((m) => m.col))];

  // Distinct families.
  const hofSet = new Set<string>();
  for (const r of rows) {
    const h = text(r["Hof Id"]);
    if (h) hofSet.add(h);
  }
  const hofList = [...hofSet];

  // 1. Upsert families (identity only — registration columns preserved on conflict).
  await chunkUpsert(supabase, "families", hofList.map((h) => ({ hof_its: h, roster_active: true })), "hof_its");

  // Map hof_its -> family id for the mumineen FK.
  const familyIdByHof = new Map<string, string>();
  for (let i = 0; i < hofList.length; i += 1000) {
    const { data, error } = await supabase
      .from("families")
      .select("id, hof_its")
      .in("hof_its", hofList.slice(i, i + 1000));
    if (error) throw new Error(`families lookup failed: ${error.message}`);
    for (const f of (data ?? []) as { id: string; hof_its: string }[]) familyIdByHof.set(f.hof_its, f.id);
  }

  // 2. Load existing import-owned values (its + mapped target columns) so a blank cell in the
  // new file keeps the previously stored value instead of nulling it (new ?? existing).
  const selectCols = ["its", ...targetCols].join(", ");
  const itsList = rows.map((r) => text(r["Mumin Id"])).filter((v): v is string => v != null);
  const existingByIts = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < itsList.length; i += 1000) {
    const { data, error } = await supabase.from("mumineen").select(selectCols).in("its", itsList.slice(i, i + 1000));
    if (error) throw new Error(`mumineen lookup failed: ${error.message}`);
    for (const m of (data ?? []) as unknown as Record<string, unknown>[]) existingByIts.set(m.its as string, m);
  }

  // 3. Upsert mumineen.
  const muminRows: Row[] = [];
  for (const r of rows) {
    const its = text(r["Mumin Id"]);
    const hof = text(r["Hof Id"]);
    if (!its || !hof) continue;
    const ex = existingByIts.get(its);
    const row: Row = {
      its,
      hof_its: hof,
      family_id: familyIdByHof.get(hof) ?? null,
      is_head: its === hof,
      roster_active: true,
    };
    for (const m of mappings) {
      row[m.col] = m.parse(r[m.header]) ?? (ex ? ex[m.col] : null) ?? null;
    }
    muminRows.push(row);
  }
  await chunkUpsert(supabase, "mumineen", muminRows, "its");

  // 4. Additive-import detection: if none of the uploaded ITS already existed, this is a new
  // batch — preserve the existing roster instead of soft-deactivating everyone missing from it.
  const deactivateMissing = existingByIts.size > 0;

  // 5. Finalize: head linkage + (when not additive) soft-deactivate rows missing from this file.
  const { error: finalizeError } = await supabase.rpc("finalize_mumineen_import", {
    p_its: muminRows.map((r) => r.its as string),
    p_hof: hofList,
    p_deactivate_missing: deactivateMissing,
  });
  if (finalizeError) throw new Error(`finalize failed: ${finalizeError.message}`);

  return {
    rows: rows.length,
    families: hofList.length,
    mumineen: muminRows.length,
    autoColumns,
    deactivatedMissing: deactivateMissing,
  };
}
