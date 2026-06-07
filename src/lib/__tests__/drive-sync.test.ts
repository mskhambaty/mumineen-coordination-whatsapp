import { describe, expect, it } from "vitest";

import { binaryType, resolveType, sameInstant, stripExtension } from "@/lib/knowledge/drive-sync";

describe("binaryType", () => {
  it("detects PDFs by mime and extension", () => {
    expect(binaryType("application/pdf", "guide.pdf")).toBe("pdf");
    expect(binaryType("", "guide.PDF")).toBe("pdf");
  });

  it("detects Word docs", () => {
    expect(
      binaryType("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "faq.docx"),
    ).toBe("word");
    expect(binaryType("", "faq.docx")).toBe("word");
  });

  it("detects Excel files", () => {
    expect(
      binaryType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "hotels.xlsx"),
    ).toBe("excel");
    expect(binaryType("", "hotels.xls")).toBe("excel");
  });

  it("detects CSV", () => {
    expect(binaryType("text/csv", "data.csv")).toBe("csv");
  });

  it("returns null for unsupported types", () => {
    expect(binaryType("image/png", "photo.png")).toBeNull();
    expect(binaryType("application/vnd.google-apps.presentation", "deck")).toBeNull();
  });
});

describe("resolveType", () => {
  it("exports Google Docs as Word", () => {
    expect(resolveType({ mimeType: "application/vnd.google-apps.document", name: "Hotels FAQ" })).toEqual({
      type: "word",
      exportMime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
  });

  it("exports Google Sheets as Excel", () => {
    expect(resolveType({ mimeType: "application/vnd.google-apps.spreadsheet", name: "Hotels" })).toEqual({
      type: "excel",
      exportMime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  });

  it("handles already-binary files with no export needed", () => {
    expect(resolveType({ mimeType: "application/pdf", name: "airports.pdf" })).toEqual({ type: "pdf" });
  });

  it("returns null for unsupported (e.g. Google Slides, images)", () => {
    expect(resolveType({ mimeType: "application/vnd.google-apps.presentation", name: "deck" })).toBeNull();
    expect(resolveType({ mimeType: "image/jpeg", name: "scan.jpg" })).toBeNull();
  });
});

describe("stripExtension", () => {
  it("removes a trailing extension", () => {
    expect(stripExtension("Accommodation FAQ.docx")).toBe("Accommodation FAQ");
    expect(stripExtension("hotels.v2.xlsx")).toBe("hotels.v2");
  });

  it("leaves names without an extension unchanged", () => {
    expect(stripExtension("Hotels FAQ")).toBe("Hotels FAQ");
  });
});

describe("sameInstant (change detection)", () => {
  it("treats equal timestamps as unchanged", () => {
    expect(sameInstant("2026-06-06T12:00:00.000Z", "2026-06-06T12:00:00Z")).toBe(true);
  });

  it("treats different timestamps as changed", () => {
    expect(sameInstant("2026-06-06T12:00:00Z", "2026-06-06T12:05:00Z")).toBe(false);
  });

  it("treats missing timestamps as changed (so it re-syncs)", () => {
    expect(sameInstant(null, "2026-06-06T12:00:00Z")).toBe(false);
    expect(sameInstant("2026-06-06T12:00:00Z", null)).toBe(false);
    expect(sameInstant(null, null)).toBe(false);
  });
});
