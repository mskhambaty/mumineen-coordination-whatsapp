import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const callerRef = {
  current: {
    user_id: "caller",
    global_role: "member",
    can_read_all: false,
    can_write_all: false,
    departments: [{ department_id: "11111111-1111-4111-8111-111111111111", department_name: "IT", dept_role: "member" }],
  },
};

const rowsRef = {
  current: [
    {
      dept_role: "pm",
      user: { id: "user-1", display_name: "Committee Member" },
    },
  ],
};

vi.mock("@/lib/api/auth", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api/auth")>();
  return {
    ...original,
    resolveCallerFromRequest: vi.fn(async () => callerRef.current),
  };
});

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: async () => ({ data: rowsRef.current, error: null }),
        }),
      }),
    }),
  }),
}));

import { GET } from "@/app/api/departments/[id]/members/route";

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("GET /api/departments/:id/members", () => {
  beforeEach(() => {
    callerRef.current = {
      user_id: "caller",
      global_role: "member",
      can_read_all: false,
      can_write_all: false,
      departments: [{ department_id: "11111111-1111-4111-8111-111111111111", department_name: "IT", dept_role: "member" }],
    };
  });

  it("returns assignment-safe member fields without phone or email PII", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/departments/11111111-1111-4111-8111-111111111111/members"),
      params("11111111-1111-4111-8111-111111111111"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      { id: "user-1", display_name: "Committee Member", department_role: "pm" },
    ]);
  });

  it("denies callers outside the department", async () => {
    callerRef.current.departments = [];

    const response = await GET(
      new NextRequest("http://localhost/api/departments/11111111-1111-4111-8111-111111111111/members"),
      params("11111111-1111-4111-8111-111111111111"),
    );

    expect(response.status).toBe(403);
  });
});
