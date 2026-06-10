import { NextRequest, NextResponse } from "next/server";

import { canAccessInbox } from "@/lib/admin/access";
import { getAIClient, AI_MODEL, PARSE_TEMPERATURE, SUMMARY_TEMPERATURE, MAX_AGENT_TOKENS, MAX_SUMMARY_TOKENS, chatParams } from "@/lib/ai/model";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getCached, setCached } from "@/lib/escalation/suggestions-cache";
import { getSupabaseAdmin } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ phoneE164: string }> };

type MatchingIssue = {
  id: string;
  issue_number: number;
  title: string;
  status: string;
  priority: string;
  department_name: string | null;
  relevance_reason: string;
};

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

  // If no context to match on, return empty
  if (!reason && !category) {
    const empty: SuggestionsResponse = { matching_issues: [], resolution_history: null };
    setCached(phone, empty);
    return NextResponse.json(empty);
  }

  // Run issue matching + resolution history in parallel
  const [matchingIssues, resolutionHistory] = await Promise.all([
    matchIssuesToEscalation(supabase, reason, category, session.escalation_priority),
    summarizeResolutionHistory(supabase, reason, category),
  ]);

  const result: SuggestionsResponse = {
    matching_issues: matchingIssues,
    resolution_history: resolutionHistory,
  };
  setCached(phone, result);
  return NextResponse.json(result);
}

// ---------------------------------------------------------------------------
// Issue matching via AI
// ---------------------------------------------------------------------------

async function matchIssuesToEscalation(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  reason: string,
  category: string,
  priority: string,
): Promise<MatchingIssue[]> {
  const { data: issues } = await supabase
    .from("issues")
    .select("id, issue_number, title, description, status, priority, department:departments(name)")
    .in("status", ["open", "in_progress"])
    .order("created_at", { ascending: false })
    .limit(100);

  if (!issues || issues.length === 0) return [];

  const issueList = issues.map((i, idx) => {
    const dept = Array.isArray(i.department) ? i.department[0] : i.department;
    return `${idx + 1}. [ISS-${i.issue_number}] ${i.title} | ${(i.description ?? "").slice(0, 120)} | Status: ${i.status} | Priority: ${i.priority} | Dept: ${dept?.name ?? "Unassigned"}`;
  }).join("\n");

  try {
    const ai = getAIClient();
    const resp = await ai.chat.completions.create({
      ...chatParams(AI_MODEL, { maxTokens: MAX_AGENT_TOKENS, temperature: PARSE_TEMPERATURE }),
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are a support triage assistant. Given an escalation and a list of open issues, identify the top 1-3 issues most likely related to this escalation. For each match, explain in one sentence why it's relevant. Only include genuinely relevant matches — if nothing is relevant, return an empty array. Return valid JSON: { "matches": [{ "issue_number": N, "reason": "..." }] }`,
        },
        {
          role: "user",
          content: `ESCALATION:\n- Reason: ${reason}\n- Category: ${category}\n- Priority: ${priority}\n\nOPEN ISSUES:\n${issueList}`,
        },
      ],
    });

    const text = resp.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(text) as { matches?: Array<{ issue_number: number; reason: string }> };
    const matches = parsed.matches ?? [];

    // Map back to full issue data
    return matches.flatMap((m) => {
      const issue = issues.find((i) => i.issue_number === m.issue_number);
      if (!issue) return [];
      const dept = Array.isArray(issue.department) ? issue.department[0] : issue.department;
      return [{
        id: issue.id,
        issue_number: issue.issue_number,
        title: issue.title,
        status: issue.status,
        priority: issue.priority,
        department_name: dept?.name ?? null,
        relevance_reason: m.reason,
      }];
    });
  } catch (err) {
    console.error("[suggestions] issue matching failed:", (err as Error).message);
    return [];
  }
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
