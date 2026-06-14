import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveLostFoundReporter = vi.fn();
const insertSingle = vi.fn();
const updateEq = vi.fn();

vi.mock("@/lib/lost-found/reporter", () => ({
  resolveLostFoundReporter: (...args: unknown[]) => resolveLostFoundReporter(...args),
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === "departments") {
        return {
          select: () => ({
            ilike: () => ({
              limit: () => ({
                maybeSingle: () => Promise.resolve({ data: { id: "lost-found-dept", name: "Lost and Found" }, error: null }),
              }),
            }),
          }),
        };
      }
      return {
        insert: () => ({
          select: () => ({
            single: () => insertSingle(),
          }),
        }),
        update: () => ({
          eq: (...args: unknown[]) => updateEq(...args),
        }),
      };
    },
  }),
}));

import { POST } from "@/app/api/lost-found/route";

const PHONE = "+15551234567";

function req(body: unknown, withPhone = true) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (withPhone) headers["x-whatsapp-from"] = PHONE;
  return new NextRequest("http://localhost/api/lost-found", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveLostFoundReporter.mockResolvedValue({
    userId: "user-1",
    muminId: "mumin-1",
    name: "Test Reporter",
    phoneE164: PHONE,
    its: "12345678",
  });
  insertSingle.mockResolvedValue({
    data: { id: "report-1", report_type: "lost", created_at: "2026-06-14T12:00:00Z" },
    error: null,
  });
  updateEq.mockResolvedValue({ error: null });
  vi.stubGlobal("fetch", vi.fn());
});

describe("POST /api/lost-found", () => {
  it("rejects callers without a WhatsApp phone header", async () => {
    const response = await POST(req({ report_type: "found", item_name: "Water bottle" }, false));
    expect(response.status).toBe(400);
    expect(insertSingle).not.toHaveBeenCalled();
  });

  it("records a found item without escalating", async () => {
    insertSingle.mockResolvedValue({
      data: { id: "report-1", report_type: "found", created_at: "2026-06-14T12:00:00Z" },
      error: null,
    });

    const response = await POST(req({ report_type: "found", item_name: "Blue water bottle", location: "Help desk" }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.report.escalation_status).toBe("not_required");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("asks unregistered callers for their name before recording", async () => {
    resolveLostFoundReporter.mockResolvedValue({
      userId: "user-1",
      muminId: null,
      name: null,
      phoneE164: PHONE,
      its: null,
    });

    const response = await POST(req({ report_type: "found", item_name: "Blue water bottle" }));

    expect(response.status).toBe(400);
    expect(insertSingle).not.toHaveBeenCalled();
  });

  it("records a lost item and sends it through the escalation route", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ status: "escalated" }), { status: 200 }));

    const response = await POST(req({ report_type: "lost", item_name: "Black backpack", location: "Masjid lobby" }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.report.escalation_status).toBe("pending");
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/escalations",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-whatsapp-from": PHONE }),
      }),
    );
    expect(updateEq).toHaveBeenCalledWith("id", "report-1");
  });
});
