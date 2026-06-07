import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => ({ rpc: vi.fn() }) }));

import { derivePortalFlags } from "@/lib/api/auth";

const base = {
  role: "committee" as string | null,
  global_role: "member" as string | null,
  departments: [] as { department_id: string; department_name: string; dept_role: string }[],
  is_escalation_support: false,
};

describe("derivePortalFlags", () => {
  it("plain internal member: internal only", () => {
    const flags = derivePortalFlags({
      ...base,
      departments: [{ department_id: "d1", department_name: "Mawaid", dept_role: "member" }],
    });
    expect(flags).toMatchObject({ is_internal: true, is_manager: false, is_it: false, is_transport: false, is_support: false });
  });

  it("dept PM is a manager", () => {
    const flags = derivePortalFlags({
      ...base,
      departments: [{ department_id: "d1", department_name: "Mawaid", dept_role: "pm" }],
    });
    expect(flags.is_manager).toBe(true);
  });

  it("global pm/hod is a manager without dept rows", () => {
    expect(derivePortalFlags({ ...base, global_role: "hod" }).is_manager).toBe(true);
  });

  it("IT and Transport derive from department names", () => {
    const flags = derivePortalFlags({
      ...base,
      departments: [
        { department_id: "d1", department_name: "IT", dept_role: "member" },
        { department_id: "d2", department_name: "Transport", dept_role: "member" },
      ],
    });
    expect(flags.is_it).toBe(true);
    expect(flags.is_transport).toBe(true);
  });

  it("passes through escalation support", () => {
    const flags = derivePortalFlags({ ...base, is_escalation_support: true });
    expect(flags.is_support).toBe(true);
  });
});
