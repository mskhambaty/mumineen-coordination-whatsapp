import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { signSessionToken, verifySessionToken } from "@/lib/admin/session-token";

describe("session token", () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = "test-secret-for-unit-tests";
  });

  afterEach(() => {
    delete process.env.SESSION_SECRET;
  });

  it("round-trips a user id", () => {
    const token = signSessionToken("user-123");
    expect(verifySessionToken(token)).toEqual({ user_id: "user-123" });
  });

  it("rejects a tampered payload", () => {
    const token = signSessionToken("user-123");
    const [payload, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ user_id: "user-999", exp: 9999999999 })).toString("base64url");
    expect(verifySessionToken(`${forged}.${sig}`)).toBeNull();
    expect(verifySessionToken(`${payload}.AAAA${sig.slice(4)}`)).toBeNull();
  });

  it("rejects an expired token", () => {
    const token = signSessionToken("user-123", -60); // expired 60s ago
    expect(verifySessionToken(token)).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const token = signSessionToken("user-123");
    process.env.SESSION_SECRET = "rotated-secret";
    expect(verifySessionToken(token)).toBeNull();
  });

  it("rejects garbage input", () => {
    expect(verifySessionToken("")).toBeNull();
    expect(verifySessionToken("not-a-token")).toBeNull();
    expect(verifySessionToken("a.b.c")).toBeNull();
  });
});
