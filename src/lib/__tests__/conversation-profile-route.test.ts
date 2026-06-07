import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SenderProfile } from "@/lib/mumineen/sender-profile";

const requireAdminKey = vi.fn();
const resolveCallerFromPhone = vi.fn();
const getSenderProfile = vi.fn();

// Keep the real auth module (UnauthorizedError, ADMIN_API_CALLER, session resolution)
// so requirePortalCaller behaves like production; stub only the key check and the
// phone-based department lookup the route uses.
vi.mock("@/lib/api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/auth")>();
  return {
    ...actual,
    requireAdminKey: (...args: unknown[]) => requireAdminKey(...args),
    resolveCallerFromPhone: (...args: unknown[]) => resolveCallerFromPhone(...args),
  };
});

vi.mock("@/lib/mumineen/sender-profile", async () => {
  // Keep the real toPublicSenderProfile so the test verifies PII stripping end-to-end.
  const actual = await vi.importActual<typeof import("@/lib/mumineen/sender-profile")>(
    "@/lib/mumineen/sender-profile",
  );
  return { ...actual, getSenderProfile: (...args: unknown[]) => getSenderProfile(...args) };
});

import { GET } from "@/app/api/admin/conversations/[phoneE164]/profile/route";

const PHONE = "+15551234567";
const ctx = { params: Promise.resolve({ phoneE164: encodeURIComponent(PHONE) }) };

function fullProfile(): SenderProfile {
  return {
    in_roster: true,
    registration_status: "submitted",
    member_count: 3,
    member: {
      full_name: "Test User",
      age: 41,
      gender: "F",
      jamaat: "Chicago",
      city: "Naperville",
      local_mehman: "Mehman",
      category: null,
      title: null,
      not_attending: false,
      arrival_at: "2026-06-24T15:00:00Z",
      arrival_flight_no: "EK203",
      airport: "ORD",
      departure_at: "2026-07-02T09:00:00Z",
      rahat_seating: false,
      wheelchair: true,
      special_needs: null,
      wants_khidmat: false,
    },
    family: {
      acc_type: "hotel",
      hotel_name: "Hyatt Place",
      utaro_host_name: null,
      open_to_utaro: false,
      transport_mode: "rideshare",
      transport_detail: null,
    },
  };
}

describe("GET /api/admin/conversations/[phoneE164]/profile", () => {
  beforeEach(() => {
    requireAdminKey.mockReset();
    resolveCallerFromPhone.mockReset();
    getSenderProfile.mockReset();
  });

  it("returns 401 without a valid admin key", async () => {
    requireAdminKey.mockReturnValue(false);
    const res = await GET(new NextRequest("http://localhost/x"), ctx);
    expect(res.status).toBe(401);
    expect(getSenderProfile).not.toHaveBeenCalled();
  });

  it("returns the profile with age stripped and committee departments included", async () => {
    requireAdminKey.mockReturnValue(true);
    getSenderProfile.mockResolvedValue(fullProfile());
    resolveCallerFromPhone.mockResolvedValue({
      global_role: "hod",
      departments: [{ department_id: "d1", department_name: "Accommodation", dept_role: "hod" }],
    });

    const res = await GET(new NextRequest("http://localhost/x"), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(getSenderProfile).toHaveBeenCalledWith(PHONE);
    expect(body.profile.member).not.toHaveProperty("age");
    expect(JSON.stringify(body)).not.toContain("41");
    expect(body.profile.family.hotel_name).toBe("Hyatt Place");
    expect(body.departments).toEqual([{ name: "Accommodation", role: "hod" }]);
    expect(body.global_role).toBe("hod");
  });

  it("returns a null profile (not an error) when the sender isn't in the roster", async () => {
    requireAdminKey.mockReturnValue(true);
    getSenderProfile.mockResolvedValue(null);
    resolveCallerFromPhone.mockRejectedValue(new Error("User not found"));

    const res = await GET(new NextRequest("http://localhost/x"), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.profile).toBeNull();
    expect(body.departments).toEqual([]);
  });
});
