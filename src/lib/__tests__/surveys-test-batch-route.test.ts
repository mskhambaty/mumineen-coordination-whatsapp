import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/api/portal-auth", () => ({ requirePortalCaller: async () => ({ id: "admin" }) }));
vi.mock("@/lib/admin/access", () => ({ isAdminOrLeadership: () => true }));
vi.mock("@/lib/surveys/tokens", () => ({ generateSurveyToken: () => "tok", chicagoToday: () => "2026-06-23" }));
vi.mock("@/lib/surveys/send", () => ({ surveyLink: (t: string) => `https://x/feedback/s/${t}`, deliverSurveyLink: async () => ({ delivered: true }) }));

const inserted: Array<Record<string, unknown>> = [];
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from(table: string) {
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = () => b;
      b.in = () => b;
      b.maybeSingle = async () => ({ data: table === "survey_forms" ? { id: "F", group_id: null } : null });
      b.insert = async (row: Record<string, unknown>) => { if (table === "survey_recipients") inserted.push(row); return { error: null }; };
      b.then = (res: (v: unknown) => void) => {
        if (table === "survey_form_questions") return res({ count: 8 });
        if (table === "mumineen") return res({ data: [{ id: "m1", its: "111", family_id: "fam", full_name: "A", whatsapp_e164: "+1" }] });
        return res({ data: null });
      };
      return b;
    },
  }),
}));

import { POST } from "@/app/api/admin/surveys/forms/[id]/test-batch/route";

function post(body: unknown) {
  return POST(new NextRequest("http://t/api/admin/surveys/forms/F/test-batch", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id: "F" }) });
}

beforeEach(() => { inserted.length = 0; });

describe("test-batch — real vs test recipients", () => {
  it("real:true creates a genuine, counted recipient (is_test=false)", async () => {
    await post({ its: ["111"], real: true });
    expect(inserted).toHaveLength(1);
    expect(inserted[0].is_test).toBe(false);
    expect(inserted[0].mumin_id).toBe("m1");
  });

  it("defaults to an is_test recipient (excluded from results)", async () => {
    await post({ its: ["111"] });
    expect(inserted[0].is_test).toBe(true);
  });
});
