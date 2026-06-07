import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const issuePasswordResetLink = vi.fn();
const sendPasswordResetEmail = vi.fn();
const maybeSingle = vi.fn();
const ilike = vi.fn(() => ({ maybeSingle }));
const select = vi.fn(() => ({ ilike }));
const from = vi.fn(() => ({ select }));

// canAccessPortal is the real (pure) predicate — driven via each profile's role.

vi.mock("@/lib/admin/password-reset", () => ({
  getAppUrl: () => "https://portal.test",
  issuePasswordResetLink: (...args: unknown[]) => issuePasswordResetLink(...args),
}));

vi.mock("@/lib/email/postmark", () => ({
  sendPasswordResetEmail: (...args: unknown[]) => sendPasswordResetEmail(...args),
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({ from }),
}));

import { POST } from "@/app/api/auth/forgot-password/route";

function postWith(email: unknown): NextRequest {
  return new NextRequest("http://localhost/api/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

const memberProfile = {
  id: "user-1",
  display_name: "Member",
  email: "member@example.com",
  role: "committee",
  global_role: "member",
  status: "active",
};

describe("POST /api/auth/forgot-password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    issuePasswordResetLink.mockResolvedValue({ url: "https://portal.test/admin/reset-password?token=abc" });
    sendPasswordResetEmail.mockResolvedValue(undefined);
  });

  it("sends a reset email to a regular member who can access the portal", async () => {
    maybeSingle.mockResolvedValue({ data: memberProfile, error: null });

    const res = await POST(postWith("Member@Example.com"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(issuePasswordResetLink).toHaveBeenCalledWith("user-1", "https://portal.test");
    expect(sendPasswordResetEmail).toHaveBeenCalledOnce();
    // Sends to the address on file, not the raw input casing.
    expect(sendPasswordResetEmail.mock.calls[0][0]).toBe("member@example.com");
  });

  it("sends to a member with no department assigned (non-visitor role)", async () => {
    // role "committee" with no membership flags — the case the user asked about.
    maybeSingle.mockResolvedValue({ data: memberProfile, error: null });

    const res = await POST(postWith("member@example.com"));

    expect(res.status).toBe(200);
    expect(sendPasswordResetEmail).toHaveBeenCalledOnce();
  });

  it("looks the user up case-insensitively (mixed-case input)", async () => {
    maybeSingle.mockResolvedValue({ data: memberProfile, error: null });

    await POST(postWith("  MEMBER@EXAMPLE.COM  "));

    expect(ilike).toHaveBeenCalledWith("email", "member@example.com");
  });

  it("does not send to a visitor (public user), returns generic ok", async () => {
    maybeSingle.mockResolvedValue({ data: { ...memberProfile, role: "visitor", global_role: "member" }, error: null });

    const res = await POST(postWith("member@example.com"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(issuePasswordResetLink).not.toHaveBeenCalled();
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("does not send to an inactive user", async () => {
    maybeSingle.mockResolvedValue({ data: { ...memberProfile, status: "inactive" }, error: null });

    const res = await POST(postWith("member@example.com"));

    expect(res.status).toBe(200);
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("returns generic ok when no email is supplied", async () => {
    const res = await POST(postWith(""));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(from).not.toHaveBeenCalled();
  });
});
