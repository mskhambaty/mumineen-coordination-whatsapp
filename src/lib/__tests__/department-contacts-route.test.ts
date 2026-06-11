import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

const requirePortalCaller = vi.fn();
const getSupabaseAdmin = vi.fn();
const sendAdminWelcomeNotification = vi.fn();

// Insert/update spies keyed by table, so tests assert what was written where.
const inserts: Record<string, Mock> = {
  department_contacts: vi.fn(),
  whatsapp_users: vi.fn(),
  department_members: vi.fn(),
};
const updates: Record<string, Mock> = {
  department_members: vi.fn(),
};

vi.mock("@/lib/api/portal-auth", () => ({
  requirePortalCaller: (...a: unknown[]) => requirePortalCaller(...a),
}));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => getSupabaseAdmin(),
}));
vi.mock("@/lib/admin/onboarding", () => ({
  sendAdminWelcomeNotification: (...a: unknown[]) => sendAdminWelcomeNotification(...a),
}));

import { GET, POST } from "@/app/api/admin/department-contacts/route";

type StubOpts = {
  existingUser?: { id: string } | null;
  existingMembership?: { id: string; dept_role?: string } | null;
  referenceRows?: Record<string, unknown>[];
  memberRows?: Record<string, unknown>[];
};

// Chainable Supabase stub. Awaiting a chain (GET's list queries) resolves to {data,error};
// POST's queries terminate in maybeSingle()/single(). Insert/update payloads are captured.
function makeSupabase(opts: StubOpts = {}) {
  return {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      Object.assign(chain, {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        delete: () => chain,
        insert: (payload: Record<string, unknown>) => { inserts[table]?.(payload); return chain; },
        update: (payload: Record<string, unknown>) => { updates[table]?.(payload); return chain; },
        maybeSingle: () => {
          if (table === "whatsapp_users") return Promise.resolve({ data: opts.existingUser ?? null, error: null });
          if (table === "department_members") return Promise.resolve({ data: opts.existingMembership ?? null, error: null });
          return Promise.resolve({ data: null, error: null });
        },
        single: () => {
          if (table === "department_contacts") {
            return Promise.resolve({ data: { id: "ref-1", department_id: "d1", name: "External Person", role: "Vendor", phone_e164: null, email: null, notes: null, display_order: 0, department: { name: "Transport" } }, error: null });
          }
          if (table === "whatsapp_users") {
            return Promise.resolve({ data: { id: opts.existingUser?.id ?? "user-new", display_name: "New Person", email: null, phone_e164: "+13125550000" }, error: null });
          }
          if (table === "department_members") {
            return Promise.resolve({ data: { id: opts.existingMembership?.id ?? "mem-new" }, error: null });
          }
          if (table === "departments") return Promise.resolve({ data: { name: "Transport" }, error: null });
          return Promise.resolve({ data: null, error: null });
        },
        // Awaitable for GET list queries.
        then: (resolve: (v: unknown) => void) => {
          if (table === "department_contacts") return resolve({ data: opts.referenceRows ?? [], error: null });
          if (table === "department_members") return resolve({ data: opts.memberRows ?? [], error: null });
          return resolve({ data: [], error: null });
        },
      });
      return chain;
    },
  };
}

function post(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/admin/department-contacts", { method: "POST", body: JSON.stringify(body) });
}

describe("POST /api/admin/department-contacts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePortalCaller.mockResolvedValue({ role: "admin", caller: { portal: {} } });
    getSupabaseAdmin.mockReturnValue(makeSupabase());
  });

  it("creates a freestanding reference contact (default mode)", async () => {
    const res = await POST(post({ department_id: "11111111-1111-4111-8111-111111111111", name: "External Person", role: "Vendor" }));
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(inserts.department_contacts).toHaveBeenCalledOnce();
    expect(inserts.whatsapp_users).not.toHaveBeenCalled();
    expect(inserts.department_members).not.toHaveBeenCalled();
    expect(data.contact.kind).toBe("reference");
  });

  it("existing_user mode flags an existing member as an issue contact (no insert, no role change)", async () => {
    getSupabaseAdmin.mockReturnValue(makeSupabase({ existingMembership: { id: "mem-7", dept_role: "hod" } }));

    const res = await POST(post({
      mode: "existing_user",
      department_id: "11111111-1111-4111-8111-111111111111",
      user_id: "22222222-2222-4222-8222-222222222222",
    }));
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(updates.department_members).toHaveBeenCalledOnce();
    const payload = updates.department_members.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.contact_for_issues).toBe(true);
    expect(payload.is_active).toBe(true);
    expect("dept_role" in payload).toBe(false); // role is managed on the Departments page, not here
    expect(inserts.department_members).not.toHaveBeenCalled();
    expect(data.contact.kind).toBe("member");
    expect(data.contact.role).toBe("HOD"); // carried from the existing membership
  });

  it("existing_user mode rejects a user who isn't a member of the department", async () => {
    // Default stub: no existing membership for this user/department.
    const res = await POST(post({
      mode: "existing_user",
      department_id: "11111111-1111-4111-8111-111111111111",
      user_id: "22222222-2222-4222-8222-222222222222",
    }));

    expect(res.status).toBe(400);
    expect(inserts.department_members).not.toHaveBeenCalled();
    expect(updates.department_members).not.toHaveBeenCalled();
  });

  it("new_user mode creates a portal user (committee/member) and a contact membership", async () => {
    const res = await POST(post({
      mode: "new_user",
      department_id: "11111111-1111-4111-8111-111111111111",
      name: "New Person",
      phone_e164: "+13125550000",
    }));
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(inserts.whatsapp_users).toHaveBeenCalledOnce();
    const userPayload = inserts.whatsapp_users.mock.calls[0][0] as Record<string, unknown>;
    expect(userPayload.role).toBe("committee");
    expect(userPayload.global_role).toBe("member");
    expect(inserts.department_members).toHaveBeenCalledOnce();
    expect(data.contact.kind).toBe("member");
  });

  it("new_user mode reuses an existing user with the same phone", async () => {
    getSupabaseAdmin.mockReturnValue(makeSupabase({ existingUser: { id: "user-9" } }));

    const res = await POST(post({
      mode: "new_user",
      department_id: "11111111-1111-4111-8111-111111111111",
      name: "Dup Person",
      phone_e164: "+13125550000",
    }));

    expect(res.status).toBe(201);
    expect(inserts.whatsapp_users).not.toHaveBeenCalled(); // reused, not recreated
    expect(inserts.department_members).toHaveBeenCalledOnce();
  });

  it("rejects an unauthorized caller without writing", async () => {
    requirePortalCaller.mockResolvedValue(NextResponse.json({ error: "forbidden" }, { status: 403 }));

    const res = await POST(post({ department_id: "11111111-1111-4111-8111-111111111111", name: "X" }));

    expect(res.status).toBe(403);
    expect(inserts.department_contacts).not.toHaveBeenCalled();
    expect(inserts.department_members).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/department-contacts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePortalCaller.mockResolvedValue({ role: "admin", caller: { portal: {} } });
  });

  it("returns both reference and member contacts", async () => {
    getSupabaseAdmin.mockReturnValue(makeSupabase({
      referenceRows: [{ id: "ref-1", department_id: "d1", name: "External", role: null, phone_e164: null, email: null, notes: null, display_order: 0, department: { name: "Transport" } }],
      memberRows: [{ id: "mem-1", department_id: "d1", dept_role: "hod", department: { name: "Transport" }, user: { id: "u1", display_name: "Staff Person", email: "s@x.com", phone_e164: "+1311" } }],
    }));

    const res = await GET(new NextRequest("http://localhost/api/admin/department-contacts"));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.contacts).toHaveLength(2);
    const kinds = data.contacts.map((c: { kind: string }) => c.kind).sort();
    expect(kinds).toEqual(["member", "reference"]);
    const member = data.contacts.find((c: { kind: string }) => c.kind === "member");
    expect(member.user_id).toBe("u1");
    expect(member.role).toBe("HOD");
  });
});
