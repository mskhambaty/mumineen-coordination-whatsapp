import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getMemberFacingAppUrl } from "@/lib/admin/password-reset";

// Env names that all map to NEXT_PUBLIC_APP_URL (see src/lib/env.ts aliases).
const APP_URL_ENV_NAMES = ["NEXT_PUBLIC_APP_URL", "App_url", "APP_URL"];

describe("getMemberFacingAppUrl", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const name of [...APP_URL_ENV_NAMES, "VERCEL_URL"]) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
  });

  afterEach(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("falls back to the production portal, never a Vercel preview host", () => {
    // Reproduces the bug: with NEXT_PUBLIC_APP_URL unset, the welcome link must
    // not pick up the per-deploy Vercel URL.
    process.env.VERCEL_URL = "project-c94rt-30xz1fe2p-cysora.vercel.app";

    const url = getMemberFacingAppUrl();

    expect(url).toBe("https://www.chicagorelaycenter.com");
    expect(url).not.toContain("vercel.app");
  });

  it("honours an explicitly configured app URL and trims trailing slashes", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://staging.chicagorelaycenter.com/";

    expect(getMemberFacingAppUrl()).toBe("https://staging.chicagorelaycenter.com");
  });
});
