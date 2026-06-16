import { parseCsv } from "@/lib/util/csv";
// Import normalizePhone from the leaf phone module (not audience.ts) so this parser stays free of
// server-only deps and can run in the browser too (e.g. the niyaz composer's CSV-upload preview).
import { normalizePhone } from "@/lib/whatsapp/phone";
import type { Recipient } from "@/lib/whatsapp/audience";

// Parse an uploaded audience CSV (the same format the app's CSV downloads use — both the audience
// export and the per-broadcast failures export) into the recipient list the broadcast engine
// consumes. Columns are matched by header (case-insensitive, order-free): the "WhatsApp" column is
// required; the friendly roster columns become per-recipient `fields` so template-variable
// personalization works like a roster-resolved audience. Unmapped columns (e.g. "Window", "Reason")
// are ignored. Recipients are deduped by normalized phone (one message per number).

// Friendly export headers (and raw field keys) → recipient field key.
const HEADER_TO_FIELD: Record<string, string> = {
  name: "full_name",
  "full name": "full_name",
  full_name: "full_name",
  its: "its",
  "hof its": "hof_its",
  hof_its: "hof_its",
  jamaat: "jamaat",
  idara: "idara",
  category: "category",
  venue: "venue",
  "venue (waaz)": "venue",
  city: "city",
  gender: "gender",
  "local/mehman": "local_mehman",
  "local / mehman": "local_mehman",
  local_mehman: "local_mehman",
  airport: "airport",
};

// Header variants that identify the phone column.
const PHONE_HEADERS = new Set(["whatsapp", "whatsapp number", "phone", "phone number", "number", "whatsapp_e164"]);

export type AudienceCsvResult = {
  recipients: Recipient[];
  parsed: number; // data rows seen (excluding the header)
  skipped: number; // rows dropped for a missing/too-short number
  duplicates: number; // rows dropped as a duplicate phone
  corrupted: number; // rows whose phone was mangled by Excel into scientific notation (unrecoverable)
  error?: string; // fatal problem (empty file / no phone column) — recipients will be empty
};

// A phone cell ruined by Excel: scientific notation like "9.17869E+11" (or any decimal/exponent
// form). The real digits are unrecoverable, so we must NOT try to send to it — flag and skip.
function looksCorrupted(raw: string): boolean {
  return /[eE]/.test(raw) || raw.includes(".");
}

export function parseAudienceCsv(csvText: string): AudienceCsvResult {
  const empty: AudienceCsvResult = { recipients: [], parsed: 0, skipped: 0, duplicates: 0, corrupted: 0 };

  // The export prepends a UTF-8 BOM for Excel; strip it so the first header isn't "﻿Name".
  const rows = parseCsv(csvText.replace(/^﻿/, ""));
  if (rows.length === 0) return { ...empty, error: "The CSV is empty." };

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const phoneIdx = header.findIndex((h) => PHONE_HEADERS.has(h));
  if (phoneIdx === -1) {
    return { ...empty, error: 'No "WhatsApp" column found. Use the audience export CSV format.' };
  }

  const fieldByIdx = new Map<number, string>();
  header.forEach((h, i) => {
    const field = HEADER_TO_FIELD[h];
    if (field && !fieldByIdx.has(i)) fieldByIdx.set(i, field);
  });

  const byPhone = new Map<string, Recipient>();
  let parsed = 0;
  let skipped = 0;
  let duplicates = 0;
  let corrupted = 0;

  for (let r = 1; r < rows.length; r += 1) {
    const cols = rows[r];
    parsed += 1;

    const rawPhone = (cols[phoneIdx] ?? "").trim();
    if (looksCorrupted(rawPhone)) {
      corrupted += 1;
      continue;
    }
    const digits = rawPhone.replace(/\D/g, "");
    // Require a plausible international number; the export always emits +E.164.
    if (digits.length < 7) {
      skipped += 1;
      continue;
    }
    const phone = normalizePhone(rawPhone);
    if (byPhone.has(phone)) {
      duplicates += 1;
      continue;
    }

    const fields: Record<string, string | null> = {};
    for (const [i, key] of fieldByIdx) {
      const v = (cols[i] ?? "").trim();
      fields[key] = v === "" ? null : v;
    }
    byPhone.set(phone, { phone, familyId: null, fields });
  }

  return { recipients: [...byPhone.values()], parsed, skipped, duplicates, corrupted };
}
