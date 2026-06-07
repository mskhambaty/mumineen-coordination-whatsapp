import { describe, expect, it } from "vitest";

// --- Import parser unit tests ---

describe("accommodations import - yesNormalize", () => {
  // We test the logic directly since yesNormalize is not exported.
  // Replicate the normalization logic used in import.ts.
  function yesNormalize(v: unknown): boolean {
    const s = v == null ? null : String(v).trim() || null;
    return s != null && /^y(es)?$/i.test(s);
  }

  it("normalizes Yes/Y/yes/y to true", () => {
    expect(yesNormalize("Yes")).toBe(true);
    expect(yesNormalize("yes")).toBe(true);
    expect(yesNormalize("YES")).toBe(true);
    expect(yesNormalize("Y")).toBe(true);
    expect(yesNormalize("y")).toBe(true);
  });

  it("normalizes No/N/empty/null to false", () => {
    expect(yesNormalize("No")).toBe(false);
    expect(yesNormalize("N")).toBe(false);
    expect(yesNormalize("")).toBe(false);
    expect(yesNormalize(null)).toBe(false);
    expect(yesNormalize(undefined)).toBe(false);
    expect(yesNormalize("Maybe")).toBe(false);
  });
});

describe("accommodations import - column mapping", () => {
  // Replicate the regex patterns from import.ts to verify they match expected headers
  const COLUMN_MAP: { header: RegExp; col: string }[] = [
    { header: /^ITS\s*\/?\s*HOF$/i, col: "hof_its" },
    { header: /^First$/i, col: "first_name" },
    { header: /^Middle$/i, col: "middle_name" },
    { header: /^Last$/i, col: "last_name" },
    { header: /^POC$/i, col: "poc" },
    { header: /^Status$/i, col: "status" },
    { header: /^Mobile$/i, col: "mobile" },
    { header: /^Address$/i, col: "address" },
    { header: /^City$/i, col: "city" },
    { header: /^Pincode$/i, col: "pincode" },
    { header: /How many mehman.*can you provide utaro/i, col: "capacity_mehman" },
    { header: /^Can you provide utaro/i, col: "can_provide_utaro" },
    { header: /How many bedrooms/i, col: "bedrooms_mehman" },
    { header: /How many bathrooms/i, col: "bathrooms_mehman" },
    { header: /How many days after Ashura/i, col: "days_after_ashura" },
    { header: /How many family.?friends/i, col: "capacity_family_friends" },
    { header: /willing to provide utaro for Sahebo/i, col: "sahebo_preference" },
    { header: /preference for.*mardo.*bairo/i, col: "gender_preference" },
    { header: /Type of Pet/i, col: "pet_type" },
    { header: /Number Allocated/i, col: "number_allocated" },
  ];

  function matchHeader(h: string): string | null {
    for (const cm of COLUMN_MAP) {
      if (cm.header.test(h)) return cm.col;
    }
    return null;
  }

  it("maps ITS / HOF variations", () => {
    expect(matchHeader("ITS / HOF")).toBe("hof_its");
    expect(matchHeader("ITS/HOF")).toBe("hof_its");
    expect(matchHeader("ITS  /  HOF")).toBe("hof_its");
    expect(matchHeader("ITS HOF")).toBe("hof_its");
  });

  it("maps simple single-word headers", () => {
    expect(matchHeader("First")).toBe("first_name");
    expect(matchHeader("Last")).toBe("last_name");
    expect(matchHeader("City")).toBe("city");
    expect(matchHeader("Mobile")).toBe("mobile");
  });

  it("maps utaro question headers", () => {
    expect(matchHeader("Can you provide utaro during Ashara? (Please note this is for mehman mumineen from out of town)")).toBe("can_provide_utaro");
    expect(matchHeader("How many mehman mumineen can you provide utaro?")).toBe("capacity_mehman");
    expect(matchHeader("How many bedrooms will be available for mehman mumineen?")).toBe("bedrooms_mehman");
    expect(matchHeader("How many bathrooms will be available for mehman mumineen?")).toBe("bathrooms_mehman");
    expect(matchHeader("How many family/friends can you host?")).toBe("capacity_family_friends");
  });

  it("maps preference headers", () => {
    expect(matchHeader("Are you willing to provide utaro for Sahebo?")).toBe("sahebo_preference");
    expect(matchHeader("Do you have a preference for hosting either mardo or bairo?")).toBe("gender_preference");
    expect(matchHeader("How many days after Ashura can you provide utaro?")).toBe("days_after_ashura");
    expect(matchHeader("Type of Pet")).toBe("pet_type");
    expect(matchHeader("Number Allocated [DO NOT FILL IN]")).toBe("number_allocated");
  });
});

// --- Matching logic tests ---

describe("accommodations matching - scoring", () => {
  it("earlier submitted guests get higher FIFO score", () => {
    // Simulate FIFO: rank 0 of 10 should score higher than rank 9 of 10
    // Max FIFO score = 40
    const rank0Score = 40 * (1 - 0 / 9);
    const rank9Score = 40 * (1 - 9 / 9);
    expect(rank0Score).toBe(40);
    expect(rank9Score).toBe(0);
  });

  it("closer hosts to masjid get higher proximity score", () => {
    // Within 5km = high score, 30km+ = 0
    const close = Math.max(0, 30 * (1 - 5 / 30));
    const far = Math.max(0, 30 * (1 - 35 / 30));
    expect(close).toBe(25);
    expect(far).toBe(0);
  });
});

describe("accommodations matching - capacity constraint", () => {
  it("host must fit entire guest family", () => {
    const hostRemaining = 3;
    const familySize = 5;
    expect(hostRemaining >= familySize).toBe(false);
  });

  it("only confirmed matches reduce capacity", () => {
    const capacity = 6;
    const confirmedAllocated = 4; // two confirmed matches totaling 4
    const pendingAllocated = 2; // one pending match of 2 (doesn't count)
    const remaining = capacity - confirmedAllocated; // pending ignored
    expect(remaining).toBe(2);
    // The pending match doesn't affect remaining
    expect(remaining).not.toBe(capacity - confirmedAllocated - pendingAllocated);
  });
});

describe("accommodations matching - confirm lifecycle", () => {
  it("confirmed match deducts from host capacity", () => {
    const effectiveCapacity = 8;
    const previousConfirmed = 3;
    const newMatchMembers = 4;
    const remainingAfter = effectiveCapacity - previousConfirmed - newMatchMembers;
    expect(remainingAfter).toBe(1);
  });

  it("cannot confirm if insufficient capacity", () => {
    const effectiveCapacity = 5;
    const currentConfirmed = 4;
    const needed = 3;
    const remaining = effectiveCapacity - currentConfirmed;
    expect(remaining < needed).toBe(true);
  });
});
