import { NextRequest, NextResponse } from "next/server";

import { canAccessInbox } from "@/lib/admin/access";
import {
  AI_MODEL,
  MAX_PARSE_TOKENS,
  PARSE_TEMPERATURE,
  chatParams,
  getAIClient,
} from "@/lib/ai/model";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EscalationDetail = {
  session_id: string;
  phone_e164: string;
  display_name: string | null;
  escalation_reason: string | null;
  escalated_at: string;
  last_message_preview: string | null;
};

type NewCluster = {
  suggested_title: string;
  suggested_description: string;
  suggested_priority: "low" | "medium" | "high";
  suggested_department_id: string | null;
  suggested_department_name: string | null;
  category: string;
  reasoning: string;
  escalations: EscalationDetail[];
};

type ExistingIssueMatch = {
  issue_id: string;
  issue_number: number;
  issue_title: string;
  issue_status: string;
  current_escalation_count: number;
  reasoning: string;
  escalations: EscalationDetail[];
};

type SuggestionsResponse = {
  new_clusters: NewCluster[];
  existing_issue_matches: ExistingIssueMatch[];
  meta: { ungrouped_count: number; analyzed_at: string };
};

// AI response shape (before hydration)
type AICluster = {
  suggested_title: string;
  suggested_description: string;
  suggested_priority: "low" | "medium" | "high";
  suggested_department_id: string | null;
  suggested_department_name: string | null;
  category: string;
  reasoning: string;
  escalation_ids: string[];
};

type AIMatch = {
  issue_id: string;
  reasoning: string;
  escalation_ids: string[];
};

type AIResult = {
  new_clusters?: AICluster[];
  existing_issue_matches?: AIMatch[];
};

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

const MAX_UNGROUPED = 50;
const MAX_OPEN_ISSUES = 100;

// ---------------------------------------------------------------------------
// GET /api/admin/issues/suggestions
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, canAccessInbox);
  if (auth instanceof NextResponse) return auth;

  const supabase = getSupabaseAdmin();

  // 1. Fetch ungrouped escalations: pending status, active stage, no linked issue
  const { data: sessions, error: sessErr } = await supabase
    .from("conversation_sessions")
    .select(
      "id, phone_e164, escalation_reason, escalated_at, escalation_stage, escalation_category, escalation_priority, user:whatsapp_users!conversation_sessions_user_id_fkey(display_name)",
    )
    .eq("escalation_status", "pending")
    .in("escalation_stage", ["pending", "picked_up"])
    .is("linked_issue_id", null)
    .order("escalated_at", { ascending: false })
    .limit(MAX_UNGROUPED);

  if (sessErr) {
    return NextResponse.json({ error: sessErr.message }, { status: 500 });
  }

  const ungrouped = sessions ?? [];

  // Short-circuit: nothing to analyze
  if (ungrouped.length === 0) {
    const empty: SuggestionsResponse = {
      new_clusters: [],
      existing_issue_matches: [],
      meta: { ungrouped_count: 0, analyzed_at: new Date().toISOString() },
    };
    return NextResponse.json(empty);
  }

  // 2. Round 1 — fetch sessions' context + open issues + departments in parallel
  const phones = ungrouped.map((s) => s.phone_e164 as string);

  const [issuesResult, deptsResult] = await Promise.all([
    supabase
      .from("issues")
      .select("id, issue_number, title, description, status, priority, department:departments(name)")
      .in("status", ["open", "in_progress"])
      .order("created_at", { ascending: false })
      .limit(MAX_OPEN_ISSUES),
    supabase.from("departments").select("id, name"),
  ]);

  if (issuesResult.error) {
    console.error("[issue-suggestions] issues fetch failed:", issuesResult.error.message);
  }
  if (deptsResult.error) {
    console.error("[issue-suggestions] departments fetch failed:", deptsResult.error.message);
  }

  const openIssues = issuesResult.data ?? [];
  const departments = deptsResult.data ?? [];

  // 2b. Round 2 — fetch links scoped to open issue IDs + last messages scoped to session phones
  const openIssueIds = openIssues.map((i) => i.id as string);

  // Only pull messages from the last 24h — for a live event older messages are
  // noise, and the escalation_reason already captures the core context.
  const msgWindowStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [linksResult, msgsResult] = await Promise.all([
    openIssueIds.length > 0
      ? supabase
          .from("issue_escalation_links")
          .select("issue_id")
          .in("issue_id", openIssueIds)
      : Promise.resolve({ data: [] as { issue_id: string }[], error: null }),
    supabase
      .from("messages")
      .select("phone_e164, body, created_at")
      .in("phone_e164", phones)
      .eq("direction", "inbound")
      .gte("created_at", msgWindowStart)
      .order("created_at", { ascending: false })
      .limit(phones.length * 10),
  ]);

  if (linksResult.error) {
    console.error("[issue-suggestions] links fetch failed:", linksResult.error.message);
  }
  if (msgsResult.error) {
    console.error("[issue-suggestions] messages fetch failed:", msgsResult.error.message);
  }

  const links = linksResult.data ?? [];
  const lastMessages = msgsResult.data ?? [];

  // Build escalation link count per issue
  const linkCountMap = new Map<string, number>();
  for (const link of links as Array<{ issue_id: string }>) {
    linkCountMap.set(link.issue_id, (linkCountMap.get(link.issue_id) ?? 0) + 1);
  }

  // Build inbound-messages map per phone (up to 5 most recent, since escalation window).
  // More messages give the AI better context for matching — single-word replies like
  // "how" or "yes" are useless alone but meaningful alongside earlier substantive messages.
  const recentMsgsMap = new Map<string, string[]>();
  for (const msg of lastMessages as Array<{ phone_e164: string; body: string | null }>) {
    if (!msg.body) continue;
    const existing = recentMsgsMap.get(msg.phone_e164) ?? [];
    if (existing.length < 5) {
      existing.push(msg.body.slice(0, 150));
      recentMsgsMap.set(msg.phone_e164, existing);
    }
  }

  // 3. Build the session lookup for hydration
  type SessionInfo = {
    id: string;
    phone_e164: string;
    display_name: string | null;
    escalation_reason: string | null;
    escalated_at: string;
  };

  const sessionMap = new Map<string, SessionInfo>();
  for (const s of ungrouped) {
    const user = Array.isArray(s.user) ? s.user[0] : s.user;
    sessionMap.set(s.id as string, {
      id: s.id as string,
      phone_e164: s.phone_e164 as string,
      display_name: (user as { display_name: string | null } | null)?.display_name ?? null,
      escalation_reason: s.escalation_reason as string | null,
      escalated_at: s.escalated_at as string,
    });
  }

  // 4. Build AI prompt
  const escalationLines = ungrouped
    .map((s, idx) => {
      const user = Array.isArray(s.user) ? s.user[0] : s.user;
      const displayName = (user as { display_name: string | null } | null)?.display_name ?? "Unknown";
      // Show messages oldest→newest so the AI follows the conversation flow
      const msgs = [...(recentMsgsMap.get(s.phone_e164 as string) ?? [])].reverse();
      const msgsText = msgs.length > 0 ? msgs.map((m) => `"${m}"`).join(" → ") : "(no recent messages)";
      return `${idx + 1}. [${s.id}] ${displayName} | Reason: ${s.escalation_reason ?? "N/A"} | Category: ${(s as Record<string, unknown>).escalation_category ?? "N/A"} | Priority: ${(s as Record<string, unknown>).escalation_priority ?? "normal"} | Recent messages: ${msgsText}`;
    })
    .join("\n");

  const issueLines =
    openIssues.length > 0
      ? openIssues
          .map((i, idx) => {
            const dept = Array.isArray(i.department) ? i.department[0] : i.department;
            const count = linkCountMap.get(i.id as string) ?? 0;
            return `${idx + 1}. [${i.id}] ISS-${i.issue_number} "${i.title}" | ${(i.description as string ?? "").slice(0, 100)} | Status: ${i.status} | Priority: ${i.priority} | Dept: ${(dept as { name: string } | null)?.name ?? "Unassigned"} | Linked escalations: ${count}`;
          })
          .join("\n")
      : "(none)";

  const deptLines =
    departments.length > 0
      ? (departments as Array<{ id: string; name: string }>)
          .map((d) => `- ${d.id}: ${d.name}`)
          .join("\n")
      : "(none)";

  const systemPrompt = `You are a triage assistant for a mosque community coordination system. Analyze ungrouped escalation conversations and suggest:

1. **Existing issue matches**: escalations that should be linked to an already-open issue. PRIORITIZE THIS — most escalations are about problems that already have a tracking issue.
2. **New clusters**: groups of 2+ escalations about the same underlying issue that should be created as a new issue (only when no existing issue fits).

Each escalation should appear in at most ONE suggestion (new cluster or existing match). Escalations that don't clearly belong anywhere should be left out — don't force-fit.

Return valid JSON with this exact shape:
{
  "new_clusters": [{
    "suggested_title": "...",
    "suggested_description": "...",
    "suggested_priority": "low" | "medium" | "high",
    "suggested_department_id": "<uuid or null>",
    "suggested_department_name": "<name or null>",
    "category": "...",
    "reasoning": "...",
    "escalation_ids": ["<session_id>", ...]
  }],
  "existing_issue_matches": [{
    "issue_id": "<uuid>",
    "reasoning": "...",
    "escalation_ids": ["<session_id>", ...]
  }]
}

Rules:
- **The "Reason" field is the most important signal** — it summarizes why the user escalated. Use it as the primary basis for matching, with message history as supporting context.
- Match an escalation to an existing issue when the reason/topic clearly relates to that issue's title or description (e.g., a "TV not working" escalation matches a "TV Issue" issue, a "network" complaint matches a "Network Issue").
- Only suggest a new cluster when 2+ escalations share a clear common theme AND no existing issue covers that theme.
- An escalation can match an existing issue even if it's the only one — single matches are valid.
- Use the department list to assign department_id/name when applicable.
- Keep reasoning concise (1-2 sentences).
- If nothing groups well, return empty arrays.`;

  const userPrompt = `UNGROUPED ESCALATIONS:\n${escalationLines}\n\nOPEN ISSUES:\n${issueLines}\n\nDEPARTMENTS:\n${deptLines}`;

  // 5. Hydrate helper (shared by AI path and keyword fallback)
  const hydrateEscalation = (sessionId: string): EscalationDetail | null => {
    const s = sessionMap.get(sessionId);
    if (!s) return null;
    return {
      session_id: s.id,
      phone_e164: s.phone_e164,
      display_name: s.display_name,
      escalation_reason: s.escalation_reason,
      escalated_at: s.escalated_at,
      last_message_preview: recentMsgsMap.get(s.phone_e164)?.[0] ?? null,
    };
  };

  // 6. Try AI analysis, with keyword fallback
  let newClusters: NewCluster[] = [];
  let existingMatches: ExistingIssueMatch[] = [];

  try {
    const ai = getAIClient();
    const resp = await ai.chat.completions.create({
      ...chatParams(AI_MODEL, { maxTokens: MAX_PARSE_TOKENS, temperature: PARSE_TEMPERATURE }),
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const text = resp.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(text) as AIResult;

    newClusters = (parsed.new_clusters ?? [])
      .map((c) => ({
        suggested_title: c.suggested_title,
        suggested_description: c.suggested_description,
        suggested_priority: c.suggested_priority,
        suggested_department_id: c.suggested_department_id,
        suggested_department_name: c.suggested_department_name,
        category: c.category,
        reasoning: c.reasoning,
        escalations: (c.escalation_ids ?? [])
          .map(hydrateEscalation)
          .filter((e): e is EscalationDetail => e !== null),
      }))
      .filter((c) => c.escalations.length >= 2);

    existingMatches = (parsed.existing_issue_matches ?? [])
      .flatMap((m) => {
        const issue = openIssues.find((i) => i.id === m.issue_id);
        if (!issue) return [];
        const escalations = (m.escalation_ids ?? [])
          .map(hydrateEscalation)
          .filter((e): e is EscalationDetail => e !== null);
        if (escalations.length < 1) return [];
        return [
          {
            issue_id: m.issue_id,
            issue_number: issue.issue_number as number,
            issue_title: issue.title as string,
            issue_status: issue.status as string,
            current_escalation_count: linkCountMap.get(m.issue_id) ?? 0,
            reasoning: m.reasoning,
            escalations,
          },
        ];
      });

    if (newClusters.length === 0 && existingMatches.length === 0) {
      console.warn("[issue-suggestions] AI returned 0 suggestions, trying keyword fallback");
    }
  } catch (err) {
    console.error("[issue-suggestions] AI analysis failed:", (err as Error).message, "— falling back to keyword matching");
  }

  // 7. Keyword fallback: if AI returned nothing, do deterministic matching
  if (existingMatches.length === 0 && openIssues.length > 0) {
    const STOP_WORDS = new Set([
      "a", "an", "the", "is", "are", "was", "were", "be", "to", "of", "in",
      "for", "on", "with", "at", "by", "from", "and", "but", "or", "not",
      "no", "this", "that", "it", "i", "my", "me", "we", "you", "they",
      "hi", "please", "yes", "yeah", "ok", "okay", "thanks", "help",
      "working", "work", "issue", "problem", "need", "want",
      // Domain-specific: appear in almost every conversation, cause false matches
      "masjid", "visitor", "visitors", "mumineen", "ashara", "venue", "team",
      "reported", "reports", "request", "requests", "requested", "assistance",
      "urgent", "escalate", "escalation", "escalated", "user", "contact",
      "information", "check", "details", "support", "follow",
    ]);
    const extractWords = (text: string) =>
      new Set(
        text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
          .filter((w) => w.length >= 2 && !STOP_WORDS.has(w)),
      );

    const keywordMatches: ExistingIssueMatch[] = [];

    for (const issue of openIssues) {
      const titleWords = extractWords(issue.title as string);
      const descWords = extractWords((issue.description as string) ?? "");
      if (titleWords.size === 0 && descWords.size === 0) continue;

      // Find escalations whose reason/messages overlap with this issue
      const matched: EscalationDetail[] = [];
      for (const s of ungrouped) {
        const reason = (s.escalation_reason as string) ?? "";
        const msgs = recentMsgsMap.get(s.phone_e164 as string) ?? [];
        const contextWords = extractWords(`${reason} ${msgs.join(" ")}`);
        let score = 0;
        for (const w of contextWords) {
          // Title matches are strong signals (worth 2)
          if (titleWords.has(w)) { score += 2; continue; }
          // Description exact matches (worth 1)
          if (descWords.has(w)) { score += 1; continue; }
          // Partial matches in title (worth 1)
          for (const tw of titleWords) {
            if (tw.includes(w) || w.includes(tw)) { score += 1; break; }
          }
        }
        if (score >= 2) {
          const detail = hydrateEscalation(s.id as string);
          if (detail) matched.push(detail);
        }
      }

      if (matched.length > 0) {
        const dept = Array.isArray(issue.department) ? issue.department[0] : issue.department;
        keywordMatches.push({
          issue_id: issue.id as string,
          issue_number: issue.issue_number as number,
          issue_title: issue.title as string,
          issue_status: issue.status as string,
          current_escalation_count: linkCountMap.get(issue.id as string) ?? 0,
          reasoning: `Keyword match: escalation context overlaps with issue "${issue.title}"`,
          escalations: matched,
        });
      }
    }

    if (keywordMatches.length > 0) {
      existingMatches = keywordMatches;
    }
  }

  {
    const result: SuggestionsResponse = {
      new_clusters: newClusters,
      existing_issue_matches: existingMatches,
      meta: {
        ungrouped_count: ungrouped.length,
        analyzed_at: new Date().toISOString(),
      },
    };

    return NextResponse.json(result);
  }
}
