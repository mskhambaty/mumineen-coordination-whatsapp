import { describe, expect, it } from "vitest";

import {
  createPasswordResetToken,
  hashPassword,
  hashPasswordResetToken,
  isValidNewPassword,
  verifyPassword,
} from "@/lib/admin/passwords";

describe("password helpers", () => {
  it("hashes and verifies passwords", async () => {
    const hash = await hashPassword("strong-password");

    expect(hash).not.toContain("strong-password");
    await expect(verifyPassword("strong-password", hash)).resolves.toBe(true);
    await expect(verifyPassword("wrong-password", hash)).resolves.toBe(false);
  });

  it("creates hashable reset tokens", () => {
    const reset = createPasswordResetToken();

    expect(reset.token.length).toBeGreaterThan(20);
    expect(reset.tokenHash).toBe(hashPasswordResetToken(reset.token));
    expect(reset.tokenHash).not.toBe(reset.token);
  });

  it("requires at least 8 characters for new passwords", () => {
    expect(isValidNewPassword("1234567")).toBe(false);
    expect(isValidNewPassword("12345678")).toBe(true);
  });
});
