import { describe, expect, it, vi } from "vitest";

// validateSubmission is pure, but it lives in the route module which imports the Supabase server
// helper. Mock it so importing the route never touches env/credentials.
vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: vi.fn() }));

import { validateSubmission } from "@/app/api/register/route";

type M = Record<string, unknown>;

const attending = (its: string): M => ({
  its,
  not_attending: false,
  whatsapp_e164: "+15551230000",
  email: "a@b.com",
  arrival_at: "2026-06-19T10:00",
  departure_at: "2026-06-22T10:00",
  wants_khidmat: false,
});
const notAttending = (its: string): M => ({ its, not_attending: true });

describe("validateSubmission — mehman family (isLocal=false)", () => {
  it("requires accommodation when at least one member is attending", () => {
    const err = validateSubmission([attending("1"), notAttending("2")] as never, {}, {}, false);
    expect(err).toBe("Accommodation type is required.");
  });

  it("does NOT require accommodation/transport when EVERY member is not attending", () => {
    const err = validateSubmission([notAttending("1"), notAttending("2")] as never, {}, {}, false);
    expect(err).toBeNull();
  });

  it("still rejects an empty member list", () => {
    const err = validateSubmission([] as never, {}, {}, false);
    expect(err).toBe("No family members were submitted.");
  });
});
