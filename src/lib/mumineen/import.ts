import * as XLSX from "xlsx";

import { getSupabaseAdmin } from "@/lib/supabase/server";

export type RosterImportResult = { rows: number; families: number; mumineen: number };

type Row = Record<string, unknown>;
type Supabase = ReturnType<typeof getSupabaseAdmin>;

const text = (v: unknown): string | null => (v == null ? null : String(v).trim() || null);
const intOrNull = (v: unknown): number | null => {
  const n = Number(v);
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

  // 2. Upsert mumineen (import-owned columns only).
  const muminRows: Row[] = [];
  for (const r of rows) {
    const its = text(r["Mumin Id"]);
    const hof = text(r["Hof Id"]);
    if (!its || !hof) continue;
    muminRows.push({
      its,
      hof_its: hof,
      family_id: familyIdByHof.get(hof) ?? null,
      is_head: its === hof,
      roster_active: true,
      full_name: text(r["Fullname"]),
      gender: genderOf(r["Gender"]),
      age: intOrNull(r["Age"]),
      jamaat: text(r["Jamaat"]),
      idara: text(r["Idara"]),
      category: text(r["Category"]),
      prefix: text(r["Prefix"]),
      title: text(r["Title"]),
      venue: text(r["Venue (Waaz)"]),
      city: text(r["City"]),
      local_mehman: text(r["Local/Mehman"]),
      roster_arrival_raw: text(r["Arr Place Date"]),
      roster_flight_code: text(r["Flight Code"]),
      daily_trans: text(r["Daily Trans"]),
      whatsapp_link_clicked: yesNo(r["Whatsapp Link Clicked?"]),
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
