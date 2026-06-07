import * as XLSX from "xlsx";

import { getSupabaseAdmin } from "@/lib/supabase/server";

export type HostImportResult = {
  rows: number;
  hostsUpserted: number;
  importId: string;
};

type Row = Record<string, unknown>;

const text = (v: unknown): string | null => (v == null ? null : String(v).trim() || null);
const intOrNull = (v: unknown): number | null => {
  const s = text(v);
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

/**
 * Normalize "Yes", "Y", "yes", "y" → true; everything else → false.
 */
function yesNormalize(v: unknown): boolean {
  const s = text(v);
  return s != null && /^y(es)?$/i.test(s);
}

// Map spreadsheet headers → DB columns with typed parsers.
const COLUMN_MAP: { header: RegExp; col: string; parse: (v: unknown) => unknown }[] = [
  { header: /^ITS\s*\/?\s*HOF$/i, col: "hof_its", parse: text },
  { header: /^First$/i, col: "first_name", parse: text },
  { header: /^Middle$/i, col: "middle_name", parse: text },
  { header: /^Last$/i, col: "last_name", parse: text },
  { header: /^POC$/i, col: "poc", parse: text },
  { header: /^Status$/i, col: "status", parse: text },
  { header: /^Mobile$/i, col: "mobile", parse: text },
  { header: /^Address$/i, col: "address", parse: text },
  { header: /^City$/i, col: "city", parse: text },
  { header: /^Pincode$/i, col: "pincode", parse: text },
  { header: /How many mehman.*can you provide utaro/i, col: "capacity_mehman", parse: intOrNull },
  { header: /^Can you provide utaro/i, col: "can_provide_utaro", parse: yesNormalize },
  { header: /How many bedrooms/i, col: "bedrooms_mehman", parse: intOrNull },
  { header: /How many bathrooms/i, col: "bathrooms_mehman", parse: intOrNull },
  { header: /How many days after Ashura/i, col: "days_after_ashura", parse: intOrNull },
  { header: /How many family.?friends/i, col: "capacity_family_friends", parse: intOrNull },
  { header: /willing to provide utaro for Sahebo/i, col: "sahebo_preference", parse: text },
  { header: /preference for.*mardo.*bairo/i, col: "gender_preference", parse: text },
  { header: /Type of Pet/i, col: "pet_type", parse: text },
  { header: /Number Allocated/i, col: "number_allocated", parse: intOrNull },
];

// --- Geocoding via Nominatim (OpenStreetMap) ---

type GeoResult = { lat: number; lon: number } | null;

/**
 * Geocode an address via Nominatim. Returns null if geocoding fails.
 */
export async function geocodeAddress(address: string, city: string | null): Promise<GeoResult> {
  const query = [address, city, "IL", "USA"].filter(Boolean).join(", ");
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "MumineenAccommodations/1.0" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      const lat = parseFloat(data[0].lat);
      const lon = parseFloat(data[0].lon);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        return { lat, lon };
      }
    }
  } catch {
    // Geocoding failure is non-fatal
  }
  return null;
}

/**
 * Build header → column mapping from the actual sheet headers present.
 */
function buildMapping(headers: string[]): { header: string; col: string; parse: (v: unknown) => unknown }[] {
  const mappings: { header: string; col: string; parse: (v: unknown) => unknown }[] = [];
  for (const h of headers) {
    for (const cm of COLUMN_MAP) {
      if (cm.header.test(h)) {
        mappings.push({ header: h, col: cm.col, parse: cm.parse });
        break;
      }
    }
  }
  return mappings;
}

/**
 * Import accommodation hosts from an Excel buffer. Upserts by hof_its.
 */
export async function importAccommodationHosts(
  buffer: Buffer,
  filename?: string,
  uploadedBy?: string,
): Promise<HostImportResult> {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<Row>(ws, { defval: null });

  if (raw.length === 0) {
    throw new Error("No rows found in the spreadsheet.");
  }

  // Collect all headers from the first row object keys.
  const headers = Object.keys(raw[0]);
  const mappings = buildMapping(headers);

  if (!mappings.some((m) => m.col === "hof_its")) {
    throw new Error("Missing required column: ITS / HOF. Cannot identify hosts.");
  }

  // Filter to rows that have a valid ITS.
  const validRows = raw.filter((r) => {
    const itsMapping = mappings.find((m) => m.col === "hof_its");
    return itsMapping && text(r[itsMapping.header]) != null;
  });

  if (validRows.length === 0) {
    throw new Error("No rows with a valid ITS / HOF value found.");
  }

  const supabase = getSupabaseAdmin();

  // 1. Record the import with raw JSON.
  const { data: importRow, error: importErr } = await supabase
    .from("accommodation_host_imports")
    .insert({
      filename,
      uploaded_by: uploadedBy,
      row_count: validRows.length,
      raw_json: validRows,
    })
    .select("id")
    .single();

  if (importErr) throw new Error(`Failed to record import: ${importErr.message}`);
  const importId = importRow.id as string;

  // 2. Build host records and upsert.
  const parsedHostRows = validRows.map((r) => {
    const row: Record<string, unknown> = { import_id: importId, updated_at: new Date().toISOString() };
    for (const m of mappings) {
      const val = m.parse(r[m.header]);
      // capacity fields: default to 0 if null
      if ((m.col === "capacity_mehman" || m.col === "capacity_family_friends" || m.col === "number_allocated") && val == null) {
        row[m.col] = 0;
      } else if (m.col === "can_provide_utaro") {
        row[m.col] = val ?? false;
      } else {
        row[m.col] = val;
      }
    }
    return row;
  });

  // A single upsert statement cannot contain the same conflict key twice.
  // Deduplicate by hof_its and merge duplicates by preferring non-null values.
  const byHof = new Map<string, Record<string, unknown>>();
  for (const row of parsedHostRows) {
    const hof = text(row.hof_its);
    if (!hof) continue;
    const existing = byHof.get(hof);
    if (!existing) {
      byHof.set(hof, row);
      continue;
    }

    const merged = { ...existing };
    for (const [k, v] of Object.entries(row)) {
      if (v !== null && v !== "") merged[k] = v;
    }
    merged.updated_at = new Date().toISOString();
    byHof.set(hof, merged);
  }
  const hostRows = [...byHof.values()];

  // Chunk upsert by hof_its.
  const CHUNK = 500;
  for (let i = 0; i < hostRows.length; i += CHUNK) {
    const { error } = await supabase
      .from("accommodation_hosts")
      .upsert(hostRows.slice(i, i + CHUNK), { onConflict: "hof_its" });
    if (error) throw new Error(`Host upsert failed: ${error.message}`);
  }

  return { rows: raw.length, hostsUpserted: hostRows.length, importId };
}
