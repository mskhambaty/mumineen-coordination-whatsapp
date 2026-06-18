import { NextRequest, NextResponse } from "next/server";

import { canMonitorReligiousChats } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { RELIGIOUS_TOOL_NAMES } from "@/lib/admin/religious-transcript";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
// Never cache: the religious Inbox polls this for live updates (without it the GET response is
// served stale — the cause of the old Chats tab going out of date).
export const dynamic = "force-dynamic";

const WINDOW_MS = 24 * 60 * 60 * 1000; // WhatsApp 24h reply window (drives the reply box)
const MAX_CONVERSATIONS = 200;

// Lookback options for "show religious chats active in the last N hours". Default 48h.
const ALLOWED_WINDOW_HOURS = [24, 48, 168] as const;
const DEFAULT_WINDOW_HOURS = 48;

function parseWindowHours(raw: string | null): number {
  const n = Number(raw);
  return (ALLOWED_WINDOW_HOURS as readonly number[]).includes(n) ? n : DEFAULT_WINDOW_HOURS;
}

// GET: conversations whose RELIGIOUS TOOL was called within the lookback window (default 48h),
// newest religious-activity first, each with its thread + 24h-window state. Membership is scoped by
// tool-CALL recency (not message activity) so a chat that used a religious tool days ago but only got
// a logistics/template message today no longer clutters the Inbox. A chat in Manual mode with a
// recent handoff is kept (bounded by the same window) so an active monitor handoff doesn't vanish.
// The general Conversations inbox keeps its all-time "Religious / Lisan" filter as the archive.
// ?windowHours=24|48|168 (default 48).
export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, canMonitorReligiousChats);
  if (auth instanceof NextResponse) return auth;

  const windowHours = parseWindowHours(req.nextUrl.searchParams.get("windowHours"));
  const cutoffMs = Date.now() - windowHours * 60 * 60 * 1000;
  const cutoffIso = new Date(cutoffMs).toISOString();

  const supabase = getSupabaseAdmin();

  // Phones with a religious tool-call INSIDE the window, newest first. The first time we see a phone
  // (descending order) is its latest religious call → lastReligiousCallAt.
  const { data: audit, error: auditError } = await supabase
    .from("tool_audit_logs")
    .select("phone_e164, created_at")
    .in("tool_name", [...RELIGIOUS_TOOL_NAMES])
    .not("phone_e164", "is", null)
    .gte("created_at", cutoffIso)
    .order("created_at", { ascending: false })
    .limit(5000);
  if (auditError) return NextResponse.json({ error: auditError.message }, { status: 500 });

  const lastReligiousCallAt = new Map<string, string>();
  for (const row of (audit ?? []) as { phone_e164: string; created_at: string }[]) {
    if (!lastReligiousCallAt.has(row.phone_e164)) lastReligiousCallAt.set(row.phone_e164, row.created_at);
    if (lastReligiousCallAt.size >= MAX_CONVERSATIONS) break;
  }

  // Manual-mode exception (bounded by the window): a chat a monitor switched to Manual recently
  // should stay visible even if its last religious tool-call has aged past the window — but only if
  // it is genuinely a religious chat (ever used a religious tool), so logistics manual chats from the
  // general inbox don't leak in here.
  const { data: manualSessions } = await supabase
    .from("conversation_sessions")
    .select("phone_e164, handling_mode, handling_mode_at")
    .eq("handling_mode", "manual")
    .gte("handling_mode_at", cutoffIso)
    .limit(MAX_CONVERSATIONS);
  const manualHandoffAt = new Map<string, string>();
  const manualCandidates = ((manualSessions ?? []) as { phone_e164: string; handling_mode_at: string | null }[])
    .filter((s) => s.phone_e164 && !lastReligiousCallAt.has(s.phone_e164));
  if (manualCandidates.length) {
    const { data: everReligious } = await supabase
      .from("tool_audit_logs")
      .select("phone_e164")
      .in("tool_name", [...RELIGIOUS_TOOL_NAMES])
      .in("phone_e164", manualCandidates.map((s) => s.phone_e164))
      .limit(5000);
    const religiousSet = new Set(((everReligious ?? []) as { phone_e164: string }[]).map((r) => r.phone_e164));
    for (const s of manualCandidates) {
      if (religiousSet.has(s.phone_e164) && s.handling_mode_at) manualHandoffAt.set(s.phone_e164, s.handling_mode_at);
    }
  }

  const phones = Array.from(new Set([...lastReligiousCallAt.keys(), ...manualHandoffAt.keys()])).slice(
    0,
    MAX_CONVERSATIONS,
  );
  if (phones.length === 0) return NextResponse.json({ conversations: [] });

  const [{ data: msgs }, { data: users }, { data: sessions }] = await Promise.all([
    supabase
      .from("messages")
      .select("phone_e164, direction, body, created_at")
      .in("phone_e164", phones)
      // DESCENDING (newest first) is critical: PostgREST caps the response at its db-max-rows
      // setting (~1000), which OVERRIDES .limit(8000). Ascending order would return the OLDEST
      // ~1000 messages and drop everything recent, making every last_at stale (the Jun-14 bug).
      // Newest-first keeps the recent messages; we restore chronological order per phone below.
      .order("created_at", { ascending: false })
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
  // Messages were fetched newest-first (see the query above); restore chronological order so the
  // thread reads oldest→newest and last_at is the genuinely newest message.
  for (const list of byPhone.values()) list.reverse();

  const now = Date.now();
  const conversations = phones.map((phone) => {
    const list = byPhone.get(phone) ?? [];
    const lastInbound = [...list].reverse().find((m) => m.direction === "inbound");
    const inWindow = lastInbound ? now - new Date(lastInbound.created_at).getTime() < WINDOW_MS : false;
    const lastAt = list.length ? list[list.length - 1].created_at : null;
    const session = sessionByPhone.get(phone);
    // Sort key = the latest GENUINE religious activity: the religious tool-call, a manual handoff, or
    // the member's last inbound. Outbound templates/broadcasts are excluded so they can't bump a chat.
    const sortKey = [
      lastReligiousCallAt.get(phone),
      manualHandoffAt.get(phone),
      lastInbound?.created_at,
    ]
      .filter((v): v is string => Boolean(v))
      .sort()
      .pop() ?? "";
    return {
      phone,
      phone_last4: phone.slice(-4),
      name: nameByPhone.get(phone) ?? null,
      last_at: lastAt,
      in_window: inWindow,
      handling_mode: session?.handling_mode === "manual" ? "manual" : "ai",
      handling_mode_at: session?.handling_mode_at ?? null,
      sort_key: sortKey,
      messages: list.map((m) => ({ direction: m.direction, body: m.body ?? "", created_at: m.created_at })),
    };
  });

  // Newest religious activity first.
  conversations.sort((a, b) => b.sort_key.localeCompare(a.sort_key));

  return NextResponse.json({ conversations, window_hours: windowHours });
}
