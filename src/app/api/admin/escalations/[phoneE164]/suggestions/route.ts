import { NextRequest, NextResponse } from "next/server";

import { canAccessInbox } from "@/lib/admin/access";
import { getAIClient, AI_MODEL, SUMMARY_TEMPERATURE, MAX_SUMMARY_TOKENS, chatParams } from "@/lib/ai/model";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import {
  type MatchingIssue,
  matchIssuesToEscalation,
  meetsConfidence,
  SUGGESTION_CONFIDENCE_THRESHOLD,
} from "@/lib/escalation/issue-match";
import { getCached, setCached } from "@/lib/escalation/suggestions-cache";
import { getSupabaseAdmin } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ phoneE164: string }> };

type SuggestionsResponse = {
  matching_issues: MatchingIssue[];
  resolution_history: { summary: string; past_count: number } | null;
};

export async function GET(req: NextRequest, { params }: RouteContext) {
  const auth = await requirePortalCaller(req, canAccessInbox);
  if (auth instanceof NextResponse) return auth;

  const { phoneE164 } = await params;
  const phone = decodeURIComponent(phoneE164);

  // Check cache first
  const cached = getCached<SuggestionsResponse>(phone);
  if (cached) return NextResponse.json(cached);

  const supabase = getSupabaseAdmin();

  // Fetch escalation context
  const { data: session, error: sessErr } = await supabase
    .from("conversation_sessions")
    .select("id, escalation_reason, escalation_category, escalation_priority, escalation_status")
    .eq("phone_e164", phone)
    .maybeSingle();

  if (sessErr) return NextResponse.json({ error: sessErr.message }, { status: 500 });
  if (!session || session.escalation_status === "none") {
    return NextResponse.json({ matching_issues: [], resolution_history: null });
  }

  const reason = session.escalation_reason ?? "";
  const category = session.escalation_category ?? "";

  // Fetch recent inbound messages (last 24h) from this conversation to supplement
  // the escalation reason — the reason can be vague ("user wants help") while the
  // actual messages contain the specifics ("the TV isn't working").
  const { data: recentMsgs } = await supabase
    .from("messages")
    .select("body")
    .eq("phone_e164", phone)
    .eq("direction", "inbound")
    .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order("created_at", { ascending: false })
    .limit(8);

  const msgContext = (recentMsgs ?? [])
    .filter((m) => m.body)
    .map((m) => (m.body as string).slice(0, 150))
    .reverse() // oldest→newest
    .join(" → ");

  // If no context to match on, return empty
  if (!reason && !category && !msgContext) {
    const empty: SuggestionsResponse = { matching_issues: [], resolution_history: null };
    setCached(phone, empty);
    return NextResponse.json(empty);
  }

  // Run issue matching + resolution history in parallel
  const [matchingIssues, resolutionHistory] = await Promise.all([
    matchIssuesToEscalation(supabase, reason, category, session.escalation_priority, msgContext),
    summarizeResolutionHistory(supabase, reason, category),
  ]);

  const result: SuggestionsResponse = {
    // Only surface confident same-problem matches; the matcher over-matches on topical adjacency,
    // so weak matches would just be noise the triager has to dismiss.
    matching_issues: matchingIssues.filter((m) => meetsConfidence(m.confidence, SUGGESTION_CONFIDENCE_THRESHOLD)),
    resolution_history: resolutionHistory,
  };
  setCached(phone, result);
  return NextResponse.json(result);
}

// ---------------------------------------------------------------------------
// Resolution history summarization
// ---------------------------------------------------------------------------

async function summarizeResolutionHistory(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  reason: string,
  category: string,
): Promise<{ summary: string; past_count: number } | null> {
  if (!category) return null;

  // Find resolved escalations with the same category that have resolution notes
  const { data: entries } = await supabase
    .from("escalation_activity_log")
    .select("details, created_at, conversation_session_id, session:conversation_sessions!inner(escalation_reason, escalation_category)")
    .eq("action", "resolved")
    .order("created_at", { ascending: false })
    .limit(50);

  // Filter to matching category with resolution notes
  const matching = (entries ?? []).filter((e) => {
    const sess = Array.isArray(e.session) ? e.session[0] : e.session;
    const details = e.details as Record<string, unknown> | null;
    return sess?.escalation_category === category && details?.resolution_note;
  }).slice(0, 10);

  if (matching.length === 0) return null;

  const historyLines = matching.map((e, idx) => {
    const sess = Array.isArray(e.session) ? e.session[0] : e.session;
    const details = e.details as Record<string, unknown>;
    const date = new Date(e.created_at).toLocaleDateString();
    return `${idx + 1}. Reason: ${sess?.escalation_reason ?? "N/A"} | Resolution: ${details.resolution_note} | Date: ${date}`;
  }).join("\n");

  try {
    const ai = getAIClient();
    const resp = await ai.chat.completions.create({
      ...chatParams(AI_MODEL, { maxTokens: MAX_SUMMARY_TOKENS, temperature: SUMMARY_TEMPERATURE }),
      messages: [
        {
          role: "system",
          content: "Summarize in 2-4 sentences how similar past escalations were resolved. Focus on patterns and common resolution approaches. Be concise and actionable.",
        },
        {
          role: "user",
          content: `Current escalation: ${reason} (category: ${category})\n\nPast resolutions (most recent first):\n${historyLines}`,
        },
      ],
    });

    const summary = resp.choices[0]?.message?.content?.trim() ?? "";
    if (!summary) return null;

    return { summary, past_count: matching.length };
  } catch (err) {
    console.error("[suggestions] resolution history failed:", (err as Error).message);
    return null;
  }
}
