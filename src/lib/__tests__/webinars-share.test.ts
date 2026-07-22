import { describe, expect, it } from "vitest";

import { WEBINAR_SHARE_PARAM, webinarShareUrl } from "@/lib/webinars/share";

describe("webinarShareUrl", () => {
  it("builds a /webinars?w=<seq> link from an origin", () => {
    expect(webinarShareUrl("https://example.com", 3)).toBe("https://example.com/webinars?w=3");
  });

  it("tolerates a trailing slash on the origin", () => {
    expect(webinarShareUrl("https://example.com/", 1)).toBe("https://example.com/webinars?w=1");
  });

  it("accepts a string seq", () => {
    expect(webinarShareUrl("http://localhost:3000", "12")).toBe("http://localhost:3000/webinars?w=12");
  });

  it("uses the shared param constant", () => {
    expect(webinarShareUrl("https://x.io", 5)).toContain(`?${WEBINAR_SHARE_PARAM}=5`);
  });
});
