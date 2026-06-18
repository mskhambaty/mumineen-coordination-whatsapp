import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const deny = () => NextResponse.json({ error: "Forbidden" }, { status: 403 });
const allow = () => ({ caller: { user_id: "u1" } });

const requirePortalCaller = vi.fn();

// Fixtures the fake Supabase resolves per (table, methods-called).
type Fixtures = {
  auditRecent: { phone_e164: string; created_at: string }[]; // religious tool-calls inside window
  everReligious: { phone_e164: string }[]; // phones that EVER used a religious tool (membership check)
  manualSessions: { phone_e164: string; handling_mode_at: string | null }[];
  sessions: { phone_e164: string; handling_mode: string | null; handling_mode_at: string | null }[];
  messages: { phone_e164: string; direction: string; body: string | null; created_at: string }[];
  users: { phone_e164: string; display_name: string | null }[];
};
let fx: Fixtures;

function resolveData(table: string, methods: string[]) {
  if (table === "tool_audit_logs") {
    // The in-window query orders by created_at; the membership check does not.
    return methods.includes("order")
      ? { data: fx.auditRecent, error: null }
      : { data: fx.everReligious, error: null };
  }
  if (table === "conversation_sessions") {
    // manualSessions filters by handling_mode (.eq); the per-phone fetch uses .in.
    return methods.includes("eq")
      ? { data: fx.manualSessions, error: null }
      : { data: fx.sessions, error: null };
  }
  if (table === "messages") return { data: fx.messages, error: null };
  if (table === "whatsapp_users") return { data: fx.users, error: null };
  return { data: [], error: null };
}

function from(table: string) {
  const methods: string[] = [];
  const b: Record<string, unknown> = {};
  const chain = (name: string) => (..._a: unknown[]) => { methods.push(name); return b; };
  for (const m of ["select", "in", "not", "gte", "eq", "order", "limit"]) b[m] = chain(m);
  // Thenable: awaiting the builder (or passing it to Promise.all) resolves the table's fixture.
  b.then = (resolve: (v: unknown) => void) => resolve(resolveData(table, methods));
  return b;
}

vi.mock("@/lib/api/portal-auth", () => ({ requirePortalCaller: (...a: unknown[]) => requirePortalCaller(...a) }));
vi.mock("@/lib/admin/access", () => ({ canMonitorReligiousChats: () => true }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => ({ from }) }));

import { GET } from "@/app/api/admin/religious/conversations/route";

function req(windowHours?: number): NextRequest {
  const qs = windowHours ? `?windowHours=${windowHours}` : "";
  return new NextRequest(`http://localhost/api/admin/religious/conversations${qs}`);
}

const nowIso = "2026-06-18T12:00:00.000Z";

beforeEach(() => {
  vi.clearAllMocks();
  requirePortalCaller.mockResolvedValue(allow());
  fx = {
    auditRecent: [{ phone_e164: "+1111", created_at: nowIso }],
    everReligious: [],
    manualSessions: [],
    sessions: [
      { phone_e164: "+1111", handling_mode: "ai", handling_mode_at: null },
    ],
    messages: [
      // +1111 — religious chat, in window
      { phone_e164: "+1111", direction: "inbound", body: "main message of waaz", created_at: nowIso },
      // +9999 — old religious call but a logistics/template message today; must NOT appear
      { phone_e164: "+9999", direction: "outbound", body: "template broadcast", created_at: nowIso },
    ],
    users: [{ phone_e164: "+1111", display_name: "Member One" }],
  };
});

describe("GET religious conversations", () => {
  it("denies a non-monitor caller (403)", async () => {
    requirePortalCaller.mockResolvedValue(deny());
    const res = await GET(req());
    expect(res.status).toBe(403);
  });

  it("includes a chat whose religious tool-call is inside the window", async () => {
    const res = await GET(req());
    const body = await res.json();
    expect(body.window_hours).toBe(48);
    expect(body.conversations.map((c: { phone: string }) => c.phone)).toEqual(["+1111"]);
  });

  it("excludes a chat whose only religious call is outside the window even with recent activity", async () => {
    // +9999 has a logistics message today (in fx.messages) but is NOT in auditRecent (its religious
    // call aged out). It must not appear — membership is by tool-call recency, not message activity.
    const res = await GET(req());
    const body = await res.json();
    const phones = body.conversations.map((c: { phone: string }) => c.phone);
    expect(phones).not.toContain("+9999");
  });

  it("keeps a recently-handed-off Manual chat that is genuinely religious", async () => {
    fx.manualSessions = [{ phone_e164: "+2222", handling_mode_at: nowIso }];
    fx.everReligious = [{ phone_e164: "+2222" }]; // confirms +2222 has used a religious tool before
    fx.sessions.push({ phone_e164: "+2222", handling_mode: "manual", handling_mode_at: nowIso });
    fx.messages.push({ phone_e164: "+2222", direction: "inbound", body: "deen question", created_at: nowIso });
    fx.users.push({ phone_e164: "+2222", display_name: "Member Two" });
    const res = await GET(req());
    const phones = (await res.json()).conversations.map((c: { phone: string }) => c.phone);
    expect(phones).toContain("+2222");
  });

  it("does NOT resurrect a Manual chat that never used a religious tool", async () => {
    fx.manualSessions = [{ phone_e164: "+3333", handling_mode_at: nowIso }];
    fx.everReligious = []; // +3333 never used a religious tool → logistics manual chat
    const res = await GET(req());
    const phones = (await res.json()).conversations.map((c: { phone: string }) => c.phone);
    expect(phones).not.toContain("+3333");
  });

  it("honours an allowed window and falls back to 48 for an invalid one", async () => {
    expect((await (await GET(req(24)).then((r) => r.json()))).window_hours).toBe(24);
    expect((await (await GET(req(999)).then((r) => r.json()))).window_hours).toBe(48);
  });
});
