import {
  getAIClient,
  AI_MODEL,
  PARSE_TEMPERATURE,
  MAX_AGENT_TOKENS,
  chatParams,
} from "@/lib/ai/model";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export type MatchConfidence = "high" | "medium" | "low";

export type MatchingIssue = {
  id: string;
  issue_number: number;
  title: string;
  status: string;
  priority: string;
  department_name: string | null;
  relevance_reason: string;
  confidence: MatchConfidence;
};

// Minimum confidence for a match to be surfaced as a grouping suggestion. Set to "high" because
// the matcher tends to over-match on topical adjacency (e.g. parking-pass requests look "related"
// to a carpool issue); only genuinely same-problem matches should reach the triager. Lower to
// "medium" to surface more (noisier) suggestions.
export const SUGGESTION_CONFIDENCE_THRESHOLD: MatchConfidence = "high";

const CONFIDENCE_RANK: Record<MatchConfidence, number> = { low: 0, medium: 1, high: 2 };

export function meetsConfidence(c: MatchConfidence, threshold: MatchConfidence): boolean {
  return CONFIDENCE_RANK[c] >= CONFIDENCE_RANK[threshold];
}

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
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "can", "shall", "to", "of", "in", "for",
  "on", "with", "at", "by", "from", "as", "into", "about", "not", "no",
  "and", "but", "or", "so", "if", "then", "that", "this", "it", "its",
  "i", "my", "me", "we", "our", "you", "your", "they", "them", "their",
  "he", "she", "hi", "please", "yes", "yeah", "ok", "okay", "thanks",
  "thank", "need", "want", "help", "working", "work", "issue", "problem",
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

export function keywordMatch(
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
      if (titleWords.has(w)) { score += 2; continue; }
      if (descWords.has(w)) { score += 1; continue; }
      for (const tw of titleWords) {
        if (tw.includes(w) || w.includes(tw)) { score += 1; break; }
      }
    }
    return { issue, score };
  }).filter((s) => s.score >= 2)
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
    // Keyword overlap is a weak signal — never "high". Cap at "medium" for strong overlap.
    confidence: (s.score >= 6 ? "medium" : "low") as MatchConfidence,
  }));
}

function normalizeConfidence(value: unknown): MatchConfidence {
  return value === "high" || value === "medium" || value === "low" ? value : "low";
}

export async function matchIssuesToEscalation(
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
    console.error("[issue-match] issues fetch failed:", issuesErr.message);
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

  try {
    const ai = getAIClient();
    const resp = await ai.chat.completions.create({
      ...chatParams(AI_MODEL, { maxTokens: MAX_AGENT_TOKENS, temperature: PARSE_TEMPERATURE }),
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are a support triage assistant. Given an escalation and a list of open issues, identify which open issues describe the SAME underlying problem or request as this escalation — not merely the same topic, department, or category. Two transport items can be unrelated (e.g. a parking-pass request is NOT the same as a carpool offer). Use the escalation reason AND the user's recent messages. For each match, give a one-sentence reason and a confidence: "high" only when it is clearly the same incident/request; "medium" when plausibly the same; "low" when only loosely related (prefer omitting low matches). If nothing is genuinely the same problem, return an empty array. Return valid JSON: { "matches": [{ "issue_number": N, "reason": "...", "confidence": "high|medium|low" }] }`,
        },
        {
          role: "user",
          content: `ESCALATION:\n${escalationContext}\n\nOPEN ISSUES:\n${issueList}`,
        },
      ],
    });

    const text = resp.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(text) as { matches?: Array<{ issue_number: number; reason: string; confidence?: unknown }> };
    const matches = parsed.matches ?? [];

    if (matches.length > 0) {
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
          confidence: normalizeConfidence(m.confidence),
        }];
      });
      if (aiResults.length > 0) return aiResults;
    }

    console.warn("[issue-match] AI returned 0 matches, trying keyword fallback");
  } catch (err) {
    console.error("[issue-match] AI matching failed:", (err as Error).message, "— falling back to keyword matching");
  }

  return keywordMatch(issues as IssueRow[], reason, msgContext);
}
