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
    matching_issues: matchingIssues,
    resolution_history: resolutionHistory,
  };
  setCached(phone, result);
  return NextResponse.json(result);
}

// ---------------------------------------------------------------------------
// Issue matching via AI
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Keyword fallback: deterministic matching when AI is unavailable or fails.
// Extracts significant words from escalation context and scores each open
// issue by how many words overlap with its title + description.
// ---------------------------------------------------------------------------

type IssueRow = {
  id: string;
  issue_number: number;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  department: { name: string } | { name: string }[] | null;
};

const STOP_WORDS = new Set([
  // English stop words
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "can", "shall", "to", "of", "in", "for",
  "on", "with", "at", "by", "from", "as", "into", "about", "not", "no",
  "and", "but", "or", "so", "if", "then", "that", "this", "it", "its",
  "i", "my", "me", "we", "our", "you", "your", "they", "them", "their",
  "he", "she", "hi", "please", "yes", "yeah", "ok", "okay", "thanks",
  "thank", "need", "want", "help", "working", "work", "issue", "problem",
  // Domain-specific: these appear in almost every conversation and cause false matches
  "masjid", "visitor", "visitors", "mumineen", "ashara", "venue", "team",
  "reported", "reports", "request", "requests", "requested", "assistance",
  "urgent", "escalate", "escalation", "escalated", "user", "contact",
  "information", "check", "details", "support", "follow",
]);

function extractKeywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 2 && !STOP_WORDS.has(w)),
  );
}

function deptName(issue: IssueRow): string | null {
  const dept = Array.isArray(issue.department) ? issue.department[0] : issue.department;
  return (dept as { name: string } | null)?.name ?? null;
}

function keywordMatch(
  issues: IssueRow[],
  reason: string,
  msgContext: string,
): MatchingIssue[] {
  const contextText = `${reason} ${msgContext}`;
  const keywords = extractKeywords(contextText);
  if (keywords.size === 0) return [];

  const scored = issues.map((issue) => {
    const titleWords = extractKeywords(issue.title);
    const descWords = extractKeywords(issue.description ?? "");
    let score = 0;
    for (const w of keywords) {
      // Title matches are strong signals (worth 2)
      if (titleWords.has(w)) { score += 2; continue; }
      // Description exact matches (worth 1)
      if (descWords.has(w)) { score += 1; continue; }
      // Partial matches in title (worth 1)
      for (const tw of titleWords) {
        if (tw.includes(w) || w.includes(tw)) { score += 1; break; }
      }
    }
    return { issue, score };
  }).filter((s) => s.score >= 2) // Need at least one strong match (title) or two description hits
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  return scored.map((s) => ({
    id: s.issue.id as string,
    issue_number: s.issue.issue_number as number,
    title: s.issue.title as string,
    status: s.issue.status as string,
    priority: s.issue.priority as string,
    department_name: deptName(s.issue),
    relevance_reason: `Keyword match based on escalation context`,
  }));
}

async function matchIssuesToEscalation(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  reason: string,
  category: string,
  priority: string,
  msgContext: string,
): Promise<MatchingIssue[]> {
  const { data: issues, error: issuesErr } = await supabase
    .from("issues")
    .select("id, issue_number, title, description, status, priority, department:departments(name)")
    .in("status", ["open", "in_progress"])
    .order("created_at", { ascending: false })
    .limit(100);

  if (issuesErr) {
    console.error("[suggestions] issues fetch failed:", issuesErr.message);
  }

  if (!issues || issues.length === 0) return [];

  const issueList = issues.map((i, idx) => {
    const dept = Array.isArray(i.department) ? i.department[0] : i.department;
    return `${idx + 1}. [ISS-${i.issue_number}] ${i.title} | ${((i.description as string) ?? "").slice(0, 120)} | Status: ${i.status} | Priority: ${i.priority} | Dept: ${(dept as { name: string } | null)?.name ?? "Unassigned"}`;
  }).join("\n");

  const escalationContext = [
    reason ? `- Reason: ${reason}` : null,
    `- Category: ${category || "N/A"}`,
    `- Priority: ${priority}`,
    msgContext ? `- Recent messages (oldest→newest): ${msgContext}` : null,
  ].filter(Boolean).join("\n");

  // Try AI matching first
  try {
    const ai = getAIClient();
    const resp = await ai.chat.completions.create({
      ...chatParams(AI_MODEL, { maxTokens: MAX_AGENT_TOKENS, temperature: PARSE_TEMPERATURE }),
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are a support triage assistant. Given an escalation and a list of open issues, identify the top 1-3 issues most likely related to this escalation. Use the escalation reason AND the user's recent messages to determine what the issue is about. For each match, explain in one sentence why it's relevant. Only include genuinely relevant matches — if nothing is relevant, return an empty array. Return valid JSON: { "matches": [{ "issue_number": N, "reason": "..." }] }`,
        },
        {
          role: "user",
          content: `ESCALATION:\n${escalationContext}\n\nOPEN ISSUES:\n${issueList}`,
        },
      ],
    });

    const text = resp.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(text) as { matches?: Array<{ issue_number: number; reason: string }> };
    const matches = parsed.matches ?? [];

    if (matches.length > 0) {
      // Map back to full issue data
      const aiResults = matches.flatMap((m) => {
        const issue = issues.find((i) => i.issue_number === m.issue_number);
        if (!issue) return [];
        return [{
          id: issue.id as string,
          issue_number: issue.issue_number as number,
          title: issue.title as string,
          status: issue.status as string,
          priority: issue.priority as string,
          department_name: deptName(issue as IssueRow),
          relevance_reason: m.reason,
        }];
      });
      if (aiResults.length > 0) return aiResults;
    }

    // AI returned empty matches — fall through to keyword fallback
    console.warn("[suggestions] AI returned 0 matches, trying keyword fallback");
  } catch (err) {
    console.error("[suggestions] AI issue matching failed:", (err as Error).message, "— falling back to keyword matching");
  }

  // Fallback: deterministic keyword matching
  return keywordMatch(issues as IssueRow[], reason, msgContext);
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
