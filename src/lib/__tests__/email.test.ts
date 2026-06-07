import { describe, expect, it } from "vitest";

import { emailMatchPattern, normalizeEmail } from "@/lib/admin/email";

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Member@Example.COM ")).toBe("member@example.com");
  });
});

describe("emailMatchPattern", () => {
  it("normalizes case for case-insensitive matching", () => {
    expect(emailMatchPattern("Member@Example.com")).toBe("member@example.com");
  });

  it("escapes LIKE wildcards so the address matches literally", () => {
    // `_` is a valid local-part char and a LIKE wildcard; it must be escaped or
    // it would match any single character.
    expect(emailMatchPattern("a_b%c@x.com")).toBe("a\\_b\\%c@x.com");
    expect(emailMatchPattern("a\\b@x.com")).toBe("a\\\\b@x.com");
  });
});
