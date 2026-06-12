import { NextRequest, NextResponse } from "next/server";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import {
  RELIGIOUS_TOOL_NAMES,
  renderReligiousChatsHtml,
  type ExportConvo,
  type ExportTimelineItem,
} from "@/lib/admin/religious-transcript";

export const runtime = "nodejs";

const MAX_CONVOS = 1000;
const MAX_MESSAGES = 20000;

// GET /api/admin/conversations/religious-export?from=YYYY-MM-DD&to=YYYY-MM-DD
// Downloads a self-contained, mobile-readable HTML transcript of every conversation where the bot
// used a religious tool (answer_religious_questions / get_lisan_word_meaning), within the date
// range. Admin/leadership only. PII (phones, message bodies) stays inside the admin-guarded file —
// never logged.
export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, isAdminOrLeadership);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const from = url.searchParams.get("from"); // YYYY-MM-DD (inclusive)
  const to = url.searchParams.get("to"); // YYYY-MM-DD (inclusive)
  const fromIso = from ? `${from}T00:00:00.000Z` : null;
  const toIso = to ? `${to}T23:59:59.999Z` : null;

  const supabase = getSupabaseAdmin();

  // 1. Religious tool-call rows in range → the set of conversations to export (+ tool timeline).
  let toolQuery = supabase
    .from("tool_audit_logs")
    .select("phone_e164, tool_name, created_at")
    .in("tool_name", RELIGIOUS_TOOL_NAMES as unknown as string[])
    .not("phone_e164", "is", null)
    .order("created_at", { ascending: false })
    .limit(5000);
  if (fromIso) toolQuery = toolQuery.gte("created_at", fromIso);
  if (toIso) toolQuery = toolQuery.lte("created_at", toIso);

  const { data: toolRows, error: toolErr } = await toolQuery;
  if (toolErr) return NextResponse.json({ error: toolErr.message }, { status: 500 });

  const toolsByPhone = new Map<string, ExportTimelineItem[]>();
  const order: string[] = []; // phones in first-seen (newest-activity-first) order
  for (const r of (toolRows ?? []) as { phone_e164: string; tool_name: string; created_at: string }[]) {
    if (!toolsByPhone.has(r.phone_e164)) {
      toolsByPhone.set(r.phone_e164, []);
      order.push(r.phone_e164);
    }
    toolsByPhone.get(r.phone_e164)!.push({ kind: "tool", toolName: r.tool_name, at: r.created_at });
  }

  const phones = order.slice(0, MAX_CONVOS);
  const generatedAt = new Date().toISOString();
  if (phones.length === 0) {
    const empty = renderReligiousChatsHtml([], { from, to, generatedAt });
    return htmlResponse(empty, from, to);
  }

  // 2. Messages (in range) + display names for those conversations.
  let msgQuery = supabase
    .from("messages")
    .select("phone_e164, direction, body, created_at")
    .in("phone_e164", phones)
    .order("created_at", { ascending: true })
    .limit(MAX_MESSAGES);
  if (fromIso) msgQuery = msgQuery.gte("created_at", fromIso);
  if (toIso) msgQuery = msgQuery.lte("created_at", toIso);

  const [{ data: msgRows, error: msgErr }, { data: userRows }] = await Promise.all([
    msgQuery,
    supabase.from("whatsapp_users").select("phone_e164, display_name").in("phone_e164", phones),
  ]);
  if (msgErr) return NextResponse.json({ error: msgErr.message }, { status: 500 });

  const nameByPhone = new Map<string, string | null>();
  for (const u of (userRows ?? []) as { phone_e164: string; display_name: string | null }[]) {
    nameByPhone.set(u.phone_e164, u.display_name);
  }
  const msgsByPhone = new Map<string, ExportTimelineItem[]>();
  for (const r of (msgRows ?? []) as { phone_e164: string; direction: "inbound" | "outbound"; body: string | null; created_at: string }[]) {
    if (!msgsByPhone.has(r.phone_e164)) msgsByPhone.set(r.phone_e164, []);
    msgsByPhone.get(r.phone_e164)!.push({ kind: "msg", direction: r.direction, body: r.body ?? "", at: r.created_at });
  }

  // 3. Build each conversation's interleaved (messages + tool chips) timeline, sorted by time.
  const convos: ExportConvo[] = phones.map((phone) => {
    const timeline = [...(msgsByPhone.get(phone) ?? []), ...(toolsByPhone.get(phone) ?? [])].sort((a, b) =>
      a.at < b.at ? -1 : a.at > b.at ? 1 : 0,
    );
    return { displayName: nameByPhone.get(phone) ?? null, phoneLast4: phone.slice(-4), timeline };
  });

  return htmlResponse(renderReligiousChatsHtml(convos, { from, to, generatedAt }), from, to);
}

function htmlResponse(html: string, from: string | null, to: string | null): NextResponse {
  const label = `${from ?? "all"}_${to ?? "all"}`;
  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="religious-chats-${label}.html"`,
    },
  });
}
