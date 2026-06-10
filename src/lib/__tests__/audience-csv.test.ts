import { describe, expect, it, vi } from "vitest";

// audience-csv imports normalizePhone from audience.ts, which imports the supabase admin client at
// module load. Mock it so the (pure) parser can be tested without env/DB.
vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => ({}) }));

import { parseAudienceCsv } from "@/lib/whatsapp/audience-csv";

// The exact header the per-broadcast failures export emits, with a BOM prefix like the real download.
const FAILURES_HEADER = "﻿\"Name\",\"ITS\",\"WhatsApp\",\"Window\",\"Reason\"";
// The audience export header (more columns → personalization fields).
const AUDIENCE_HEADER = "\"Name\",\"ITS\",\"HOF ITS\",\"Jamaat\",\"City\",\"Gender\",\"Local/Mehman\",\"WhatsApp\",\"Window\"";

describe("parseAudienceCsv", () => {
  it("parses the failures CSV format, ignoring Window/Reason", () => {
    const csv = [
      FAILURES_HEADER,
      "\"Test Person\",\"12345678\",\"+13125550001\",\"free\",\"Delivery failed\"",
    ].join("\r\n");

    const res = parseAudienceCsv(csv);
    expect(res.error).toBeUndefined();
    expect(res.parsed).toBe(1);
    expect(res.recipients).toHaveLength(1);
    expect(res.recipients[0]).toMatchObject({ phone: "+13125550001", familyId: null, fields: { full_name: "Test Person", its: "12345678" } });
    // Window/Reason must not leak into fields.
    expect(res.recipients[0].fields).not.toHaveProperty("window");
    expect(res.recipients[0].fields).not.toHaveProperty("reason");
  });

  it("parses the audience export format into personalization fields", () => {
    const csv = [
      AUDIENCE_HEADER,
      "\"A B\",\"1\",\"10\",\"Chicago\",\"Chicago\",\"M\",\"Local\",\"+442071838750\",\"paid\"",
    ].join("\r\n");
    const res = parseAudienceCsv(csv);
    expect(res.recipients[0].fields).toMatchObject({ full_name: "A B", its: "1", hof_its: "10", jamaat: "Chicago", city: "Chicago", gender: "M", local_mehman: "Local" });
  });

  it("recovers a bare-digit number (no leading +) and dedupes by phone", () => {
    const csv = [
      FAILURES_HEADER,
      "\"A\",\"1\",\"+13125550001\",\"free\",\"\"",
      "\"A dup\",\"2\",\"13125550001\",\"paid\",\"\"", // same number, Excel dropped the +
    ].join("\r\n");
    const res = parseAudienceCsv(csv);
    expect(res.parsed).toBe(2);
    expect(res.duplicates).toBe(1);
    expect(res.recipients).toHaveLength(1);
    expect(res.recipients[0].phone).toBe("+13125550001");
    expect(res.recipients[0].fields?.full_name).toBe("A"); // first row wins
  });

  it("flags Excel-corrupted scientific-notation numbers as corrupted (not sent)", () => {
    const csv = [
      FAILURES_HEADER,
      "\"Sci\",\"1\",\"9.17869E+11\",\"free\",\"\"",
      "\"Good\",\"2\",\"+917869307055\",\"free\",\"\"",
    ].join("\r\n");
    const res = parseAudienceCsv(csv);
    expect(res.corrupted).toBe(1);
    expect(res.recipients).toHaveLength(1);
    expect(res.recipients[0].phone).toBe("+917869307055");
  });

  it("skips rows with a missing/too-short number", () => {
    const csv = [
      FAILURES_HEADER,
      "\"None\",\"1\",\"\",\"free\",\"\"",
      "\"Junk\",\"2\",\"123\",\"free\",\"\"",
      "\"Good\",\"3\",\"+13125550002\",\"free\",\"\"",
    ].join("\r\n");
    const res = parseAudienceCsv(csv);
    expect(res.skipped).toBe(2);
    expect(res.recipients).toHaveLength(1);
  });

  it("matches columns case-insensitively and ignores order", () => {
    const res = parseAudienceCsv(["whatsapp,name", "+13125550009,Lower Case"].join("\n"));
    expect(res.recipients[0]).toMatchObject({ phone: "+13125550009", fields: { full_name: "Lower Case" } });
  });

  it("errors when there is no phone column, and on an empty file", () => {
    expect(parseAudienceCsv(["Name,ITS", "Someone,123"].join("\n")).error).toMatch(/WhatsApp/i);
    expect(parseAudienceCsv("").error).toMatch(/empty/i);
  });
});
