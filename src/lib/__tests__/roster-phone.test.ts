import { describe, expect, it } from "vitest";

import { rosterPhoneToE164 } from "@/lib/mumineen/import";

describe("rosterPhoneToE164", () => {
  it("keeps already-country-coded numbers, just adding the +", () => {
    expect(rosterPhoneToE164("16308190250")).toBe("+16308190250"); // US, 11 digits
    expect(rosterPhoneToE164("919876543210")).toBe("+919876543210"); // India
    expect(rosterPhoneToE164("971501234567")).toBe("+971501234567"); // UAE
    expect(rosterPhoneToE164("923001234567")).toBe("+923001234567"); // Pakistan
  });

  it("treats a bare 10-digit number as local US (+1)", () => {
    expect(rosterPhoneToE164("6308190250")).toBe("+16308190250");
  });

  it("strips formatting (spaces, dashes, parens, leading +)", () => {
    expect(rosterPhoneToE164("+1 (630) 819-0250")).toBe("+16308190250");
    expect(rosterPhoneToE164("630-819-0250")).toBe("+16308190250");
  });

  it("returns null for blank or digit-less input", () => {
    expect(rosterPhoneToE164(null)).toBeNull();
    expect(rosterPhoneToE164("")).toBeNull();
    expect(rosterPhoneToE164("   ")).toBeNull();
    expect(rosterPhoneToE164("n/a")).toBeNull();
  });
});
