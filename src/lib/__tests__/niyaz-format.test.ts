import { describe, expect, it } from "vitest";

import { shortFamilyName } from "@/lib/rsvp/niyaz-format";

describe("shortFamilyName", () => {
  it("keeps words up to and including the first bhai/bai", () => {
    expect(shortFamilyName("Mustafa Bhai Khambaty")).toBe("Mustafa Bhai");
    expect(shortFamilyName("Fatema Bai Saifuddin Patel")).toBe("Fatema Bai");
    expect(shortFamilyName("Aliasger bhai")).toBe("Aliasger bhai");
  });

  it("is case-insensitive and ignores punctuation on the token", () => {
    expect(shortFamilyName("Husain BHAI, Najmuddin")).toBe("Husain BHAI,");
  });

  it("returns the whole name when no bhai/bai is present", () => {
    expect(shortFamilyName("Zainab Kanchwala")).toBe("Zainab Kanchwala");
  });

  it("does not match bhai inside a longer word", () => {
    expect(shortFamilyName("Bhaisaheb Tyabji")).toBe("Bhaisaheb Tyabji");
  });

  it("handles null/empty", () => {
    expect(shortFamilyName(null)).toBe("");
    expect(shortFamilyName("   ")).toBe("");
  });
});
