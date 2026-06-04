import * as XLSX from "xlsx";

import { getSupabaseAdmin } from "@/lib/supabase/server";

export type RosterImportResult = { rows: number; families: number; mumineen: number };

type Row = Record<string, unknown>;
type Supabase = ReturnType<typeof getSupabaseAdmin>;

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

async function chunkUpsert(supabase: Supabase, table: string, rows: Row[], onConflict: string, size = 500) {
  for (let i = 0; i < rows.length; i += size) {
    const { error } = await supabase.from(table).upsert(rows.slice(i, i + size), { onConflict });
    if (error) throw new Error(`${table} upsert failed: ${error.message}`);
  }
}

// Import the mumineen roster from the Excel. Idempotent: upserts families on hof_its and
// mumineen on its, updating only import-owned columns (registration-collected columns and
// whatsapp_user_id are never in the payload, so they're preserved). The finalize RPC sets
// head linkage and soft-deactivates rows that fell out of the latest file.
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

  // 2. Upsert mumineen (import-owned columns only). Blank-safe: a missing cell in the new file
  // keeps the previously stored value instead of nulling it, so a sparse re-import never wipes
  // roster attributes. We load existing import-owned values and coalesce new ?? existing.
  type ExistingRow = {
    its: string;
    full_name: string | null;
    gender: string | null;
    age: number | null;
    jamaat: string | null;
    idara: string | null;
    category: string | null;
    prefix: string | null;
    title: string | null;
    venue: string | null;
    city: string | null;
    local_mehman: string | null;
    roster_arrival_raw: string | null;
    roster_flight_code: string | null;
    daily_trans: string | null;
    whatsapp_link_clicked: boolean | null;
  };
  const EXISTING_COLS =
    "its, full_name, gender, age, jamaat, idara, category, prefix, title, venue, city, local_mehman, roster_arrival_raw, roster_flight_code, daily_trans, whatsapp_link_clicked";
  const itsList = rows.map((r) => text(r["Mumin Id"])).filter((v): v is string => v != null);
  const existingByIts = new Map<string, ExistingRow>();
  for (let i = 0; i < itsList.length; i += 1000) {
    const { data, error } = await supabase.from("mumineen").select(EXISTING_COLS).in("its", itsList.slice(i, i + 1000));
    if (error) throw new Error(`mumineen lookup failed: ${error.message}`);
    for (const m of (data ?? []) as ExistingRow[]) existingByIts.set(m.its, m);
  }

  const muminRows: Row[] = [];
  for (const r of rows) {
    const its = text(r["Mumin Id"]);
    const hof = text(r["Hof Id"]);
    if (!its || !hof) continue;
    const ex = existingByIts.get(its);
    muminRows.push({
      its,
      hof_its: hof,
      family_id: familyIdByHof.get(hof) ?? null,
      is_head: its === hof,
      roster_active: true,
      full_name: text(r["Fullname"]) ?? ex?.full_name ?? null,
      gender: genderOf(r["Gender"]) ?? ex?.gender ?? null,
      age: intOrNull(r["Age"]) ?? ex?.age ?? null,
      jamaat: text(r["Jamaat"]) ?? ex?.jamaat ?? null,
      idara: text(r["Idara"]) ?? ex?.idara ?? null,
      category: text(r["Category"]) ?? ex?.category ?? null,
      prefix: text(r["Prefix"]) ?? ex?.prefix ?? null,
      title: text(r["Title"]) ?? ex?.title ?? null,
      venue: text(r["Venue (Waaz)"]) ?? ex?.venue ?? null,
      city: text(r["City"]) ?? ex?.city ?? null,
      local_mehman: text(r["Local/Mehman"]) ?? ex?.local_mehman ?? null,
      roster_arrival_raw: text(r["Arr Place Date"]) ?? ex?.roster_arrival_raw ?? null,
      roster_flight_code: text(r["Flight Code"]) ?? ex?.roster_flight_code ?? null,
      daily_trans: text(r["Daily Trans"]) ?? ex?.daily_trans ?? null,
      whatsapp_link_clicked: yesNo(r["Whatsapp Link Clicked?"]) ?? ex?.whatsapp_link_clicked ?? null,
    });
  }
  await chunkUpsert(supabase, "mumineen", muminRows, "its");

  // 3. Finalize: head linkage + soft-deactivate rows missing from this file.
  const { error: finalizeError } = await supabase.rpc("finalize_mumineen_import", {
    p_its: muminRows.map((r) => r.its as string),
    p_hof: hofList,
  });
  if (finalizeError) throw new Error(`finalize failed: ${finalizeError.message}`);

  return { rows: rows.length, families: hofList.length, mumineen: muminRows.length };
}
