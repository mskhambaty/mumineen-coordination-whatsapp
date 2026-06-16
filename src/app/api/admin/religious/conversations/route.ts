import { NextRequest, NextResponse } from "next/server";

import { canMonitorReligiousChats } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { RELIGIOUS_TOOL_NAMES } from "@/lib/admin/religious-transcript";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

const WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_CONVERSATIONS = 200;

// GET: conversations that used a religious tool, newest activity first, with each thread's messages
// and whether the member is inside WhatsApp's 24h reply window (drives the reply box). Optional
// ?from / ?to (YYYY-MM-DD).
export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, canMonitorReligiousChats);
  if (auth instanceof NextResponse) return auth;

  const params = req.nextUrl.searchParams;
  const from = params.get("from");
  const to = params.get("to");
  const fromIso = from ? `${from}T00:00:00.000Z` : new Date(Date.now() - 30 * 86400_000).toISOString();
  const toIso = to ? `${to}T23:59:59.999Z` : null;

  const supabase = getSupabaseAdmin();

  // Phones that used a religious tool — ALL-TIME membership, matching the Inbox's "Religious / Lisan"
  // filter. We scope to the selected range later by conversation ACTIVITY (last_at), NOT by tool-call
  // time, so a recently-active member whose religious tool call is older than the window isn't dropped.
  const { data: audit, error: auditError } = await supabase
    .from("tool_audit_logs")
    .select("phone_e164, created_at")
    .in("tool_name", [...RELIGIOUS_TOOL_NAMES])
    .not("phone_e164", "is", null)
    .order("created_at", { ascending: false })
    .limit(5000);
  if (auditError) return NextResponse.json({ error: auditError.message }, { status: 500 });

  // Distinct phones in recency order, capped.
  const phones: string[] = [];
  for (const row of (audit ?? []) as { phone_e164: string }[]) {
    if (!phones.includes(row.phone_e164)) phones.push(row.phone_e164);
    if (phones.length >= MAX_CONVERSATIONS) break;
  }
  if (phones.length === 0) return NextResponse.json({ conversations: [] });

  const [{ data: msgs }, { data: users }, { data: sessions }] = await Promise.all([
    supabase
      .from("messages")
      .select("phone_e164, direction, body, created_at")
      .in("phone_e164", phones)
      .order("created_at", { ascending: true })
      .limit(8000),
    supabase.from("whatsapp_users").select("phone_e164, display_name").in("phone_e164", phones),
    // handling_mode drives the AI/Manual toggle + badge (mirrors the Inbox).
    supabase.from("conversation_sessions").select("phone_e164, handling_mode, handling_mode_at").in("phone_e164", phones),
  ]);

  const nameByPhone = new Map<string, string | null>();
  for (const u of (users ?? []) as { phone_e164: string; display_name: string | null }[]) {
    nameByPhone.set(u.phone_e164, u.display_name);
  }
  const sessionByPhone = new Map<string, { handling_mode: string | null; handling_mode_at: string | null }>();
  for (const s of (sessions ?? []) as { phone_e164: string; handling_mode: string | null; handling_mode_at: string | null }[]) {
    sessionByPhone.set(s.phone_e164, { handling_mode: s.handling_mode, handling_mode_at: s.handling_mode_at });
  }

  type Msg = { phone_e164: string; direction: string; body: string | null; created_at: string };
  const byPhone = new Map<string, Msg[]>();
  for (const m of (msgs ?? []) as Msg[]) {
    const list = byPhone.get(m.phone_e164) ?? [];
    list.push(m);
    byPhone.set(m.phone_e164, list);
  }

  const now = Date.now();
  const conversations = phones.map((phone) => {
    const list = byPhone.get(phone) ?? [];
    const lastInbound = [...list].reverse().find((m) => m.direction === "inbound");
    const inWindow = lastInbound ? now - new Date(lastInbound.created_at).getTime() < WINDOW_MS : false;
    const lastAt = list.length ? list[list.length - 1].created_at : null;
    const session = sessionByPhone.get(phone);
    return {
      phone,
      phone_last4: phone.slice(-4),
      name: nameByPhone.get(phone) ?? null,
      last_at: lastAt,
      in_window: inWindow,
      handling_mode: session?.handling_mode === "manual" ? "manual" : "ai",
      handling_mode_at: session?.handling_mode_at ?? null,
      messages: list.map((m) => ({ direction: m.direction, body: m.body ?? "", created_at: m.created_at })),
    };
  });

  // Newest activity first.
  conversations.sort((a, b) => (b.last_at ?? "").localeCompare(a.last_at ?? ""));

  // Scope to the selected window by recent ACTIVITY (keeps the "Last N days" dropdown meaningful
  // while membership stays all-time). Robust to timestamp-format differences via Date.parse.
  const fromMs = Date.parse(fromIso);
  const toMs = toIso ? Date.parse(toIso) : Infinity;
  const inRange = conversations.filter((c) => {
    if (!c.last_at) return false;
    const t = Date.parse(c.last_at);
    return t >= fromMs && t <= toMs;
  });

  return NextResponse.json({ conversations: inRange });
}
