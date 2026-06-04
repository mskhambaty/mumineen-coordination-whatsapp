import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sendPasswordResetEmail, sendWelcomeAdminEmail } from "@/lib/email/postmark";

describe("Postmark email helpers", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      To: "user@example.com",
      SubmittedAt: new Date().toISOString(),
      MessageID: "message-1",
      ErrorCode: 0,
      Message: "OK",
    }), { status: 200 })));

    process.env = {
      ...originalEnv,
      POSTMARK_API_TOKEN: "postmark-token",
      POSTMARK_FROM_EMAIL: "info@example.com",
    };
    delete process.env.POSTMARK_PASSWORD_RESET_TEMPLATE;
    delete process.env.POSTMARK_WELCOME_ADMIN_TEMPLATE;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
  });

  it("defaults password reset to the password-reset template alias", async () => {
    await sendPasswordResetEmail(
      "user@example.com",
      "Member Name",
      "https://www.chicagorelaycenter.com/admin/reset-password?token=abc",
      "https://www.chicagorelaycenter.com/admin",
    );

    expect(fetch).toHaveBeenCalledOnce();
    const [, init] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(init?.body as string) as { TemplateAlias?: string };

    expect(body.TemplateAlias).toBe("password-reset");
  });

  it("sends the welcome admin template with onboarding variables", async () => {
    await sendWelcomeAdminEmail(
      "user@example.com",
      "Member Name",
      "Parking",
      "https://www.chicagorelaycenter.com/admin/reset-password?token=abc",
      "https://www.chicagorelaycenter.com/admin/login",
    );

    expect(fetch).toHaveBeenCalledOnce();
    const [, init] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(init?.body as string) as {
      TemplateAlias?: string;
      TemplateModel?: Record<string, unknown>;
    };

    expect(body.TemplateAlias).toBe("welcome-admin-email");
    expect(body.TemplateModel).toMatchObject({
      member_name: "Member Name",
      department_name: "Parking",
      set_password_url: "https://www.chicagorelaycenter.com/admin/reset-password?token=abc",
      login_url: "https://www.chicagorelaycenter.com/admin/login",
    });
  });
});
