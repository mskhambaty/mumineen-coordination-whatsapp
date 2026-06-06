import { describe, expect, it, vi } from "vitest";

const setMock = vi.fn();
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: setMock }),
}));

import { POST } from "@/app/api/admin/auth/logout/route";

describe("POST /api/admin/auth/logout", () => {
  it("clears the session cookie without requiring auth (public by design)", async () => {
    const res = await POST();
    expect(res.status).toBe(200);
    expect(setMock).toHaveBeenCalledWith(
      "portal_session",
      "",
      expect.objectContaining({ httpOnly: true, maxAge: 0, path: "/" }),
    );
  });
});
