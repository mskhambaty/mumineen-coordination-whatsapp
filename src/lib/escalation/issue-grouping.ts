import { AI_MODEL, chatParams, getAIClient, MAX_AGENT_TOKENS, PARSE_TEMPERATURE } from "@/lib/ai/model";
import { getSupabaseAdmin } from "@/lib/supabase/server";

// Trigger B (Phase 2b): an escalation alone is NOT an issue. But when MULTIPLE distinct conversations
// report the SAME problem, that pattern is a real issue worth tracking. This runs on a cron, scans
// UNGROUPED active escalations (escalation_status='pending', no linked issue), asks the model to
// cluster genuinely same-problem ones, and promotes each high-confidence cluster of >=2 conversations
// into ONE shared issue + task. Conservative by design (high confidence, >=2 distinct) because
// auto-creating issues is a consequential action — see the over-grouping incident in docs/escalation.md.

const WINDOW_HOURS = 72;
const MAX_ESCALATIONS = 60;

type UngroupedEscalation = {
  sessionId: string;
  reason: string | null;
  category: string | null;
  departmentId: string | null;
};

export type RawCluster = { title: string; confidence?: string; sessionIds: string[] };

// PURE safety gate (unit-tested): keep only clusters that are HIGH confidence and reference >=2
// DISTINCT valid sessions; dedupe session ids and assign each session to at most one cluster. This is
// what prevents the model from over-grouping or promoting a lone escalation into an issue.
export function selectPromotableClusters(
  clusters: RawCluster[],
  validSessionIds: Set<string>,
): Array<{ title: string; sessionIds: string[] }> {
  const used = new Set<string>();
  const out: Array<{ title: string; sessionIds: string[] }> = [];
  for (const c of clusters) {
    if ((c.confidence ?? "low") !== "high") continue;
    const ids = [...new Set((c.sessionIds ?? []).filter((id) => validSessionIds.has(id) && !used.has(id)))];
    if (ids.length < 2) continue;
    ids.forEach((id) => used.add(id));
    out.push({ title: c.title?.trim() || "Grouped issue", sessionIds: ids });
  }
  return out;
}

// Ask the model to cluster same-problem escalations. Index-based (1..n) so the model never has to
// echo UUIDs; we map indices back to session ids ourselves. Best-effort — returns [] on any failure.
async function aiClusterEscalations(escalations: UngroupedEscalation[]): Promise<RawCluster[]> {
  const list = escalations
    .map((e, i) => `[${i + 1}] (category: ${e.category ?? "n/a"}) ${(e.reason ?? "").slice(0, 200)}`)
    .join("\n");
  try {
    const ai = getAIClient();
    const resp = await ai.chat.completions.create({
      ...chatParams(AI_MODEL, { maxTokens: MAX_AGENT_TOKENS, temperature: PARSE_TEMPERATURE }),
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            'You group support escalations that describe the SAME underlying problem so a shared issue can be opened. Group ONLY escalations that are clearly the SAME specific problem (e.g. several people reporting the AC is out in the same hall) — NOT merely the same topic, category, or department (a parking-pass request is NOT the same as a carpool offer; two different lost items are not the same problem). Every group MUST contain at least TWO different escalations. Give each group a short issue title and a confidence: "high" only when it is clearly the same problem; otherwise omit it. If nothing is genuinely the same problem, return an empty list. Return JSON: { "clusters": [{ "title": "...", "member_indices": [1,2], "confidence": "high|medium|low" }] }',
        },
        { role: "user", content: `ESCALATIONS:\n${list}` },
      ],
    });
    const text = resp.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(text) as { clusters?: Array<{ title?: string; member_indices?: number[]; confidence?: string }> };
    return (parsed.clusters ?? []).map((c) => ({
      title: (c.title ?? "").trim(),
      confidence: c.confidence,
      sessionIds: (c.member_indices ?? [])
        .map((idx) => escalations[idx - 1]?.sessionId)
        .filter((id): id is string => Boolean(id)),
    }));
  } catch (err) {
    console.error("[issue-grouping] AI clustering failed:", (err as Error).message);
    return [];
  }
}

function mostCommon(values: string[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  let bestN = 0;
  for (const [v, n] of counts) {
    if (n > bestN) { best = v; bestN = n; }
  }
  return best;
}

async function createIssueForCluster(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  cluster: { title: string; sessionIds: string[] },
  escalations: UngroupedEscalation[],
): Promise<boolean> {
  const members = escalations.filter((e) => cluster.sessionIds.includes(e.sessionId));
  const departmentId = mostCommon(members.map((m) => m.departmentId).filter((d): d is string => Boolean(d)));
  const description = `Auto-grouped from ${cluster.sessionIds.length} conversations reporting the same problem.`;

  const { data: issue, error } = await supabase
    .from("issues")
    .insert({ title: cluster.title, description, priority: "medium", department_id: departmentId })
    .select("id")
    .single();
  if (error || !issue) {
    console.error("[issue-grouping] issue creation failed:", error?.message);
    return false;
  }

  for (const sessionId of cluster.sessionIds) {
    await supabase.from("issue_escalation_links").insert({ issue_id: issue.id, conversation_session_id: sessionId });
    await supabase.from("conversation_sessions").update({ linked_issue_id: issue.id }).eq("id", sessionId);
    try {
      const { logEscalationActivity } = await import("@/lib/escalation/activity");
      await logEscalationActivity({
        sessionId, issueId: issue.id, action: "linked_to_issue", actorLabel: "Auto-grouping",
        details: { source: "cron_clustering" },
      });
    } catch { /* fire-and-forget */ }
  }

  await supabase.from("tasks").insert({
    title: cluster.title, description, department_id: departmentId, priority: "medium",
    item_type: "issue", source: "whatsapp_agent", origin: "external",
  });

  try {
    const { logEscalationActivity } = await import("@/lib/escalation/activity");
    await logEscalationActivity({
      issueId: issue.id, action: "created_issue", actorLabel: "Auto-grouping",
      details: { title: cluster.title, conversations: cluster.sessionIds.length, source: "cron_clustering" },
    });
  } catch { /* fire-and-forget */ }

  // Deliberately NO department notification here: an auto-grouped issue is a lower-confidence,
  // model-created artifact, so it surfaces in the Issues tab for a triager to review and notify
  // a department deliberately — we never auto-send outward-facing messages from this cron.
  return true;
}

// Scan ungrouped active escalations, cluster same-problem ones, and promote each high-confidence
// cluster of >=2 conversations into a shared issue. Returns a summary for the cron response.
export async function clusterUngroupedEscalations(
  opts?: { windowHours?: number; max?: number },
): Promise<{ scanned: number; issuesCreated: number; linked: number }> {
  const supabase = getSupabaseAdmin();
  const windowHours = opts?.windowHours ?? WINDOW_HOURS;
  const max = opts?.max ?? MAX_ESCALATIONS;
  const since = new Date(Date.now() - windowHours * 3_600_000).toISOString();

  const { data } = await supabase
    .from("conversation_sessions")
    .select("id, escalation_reason, escalation_category, escalation_department_id")
    .eq("escalation_status", "pending")
    .is("linked_issue_id", null)
    .gte("escalated_at", since)
    .order("escalated_at", { ascending: false })
    .limit(max);

  const escalations: UngroupedEscalation[] = ((data ?? []) as Array<{
    id: string; escalation_reason: string | null; escalation_category: string | null; escalation_department_id: string | null;
  }>).map((r) => ({ sessionId: r.id, reason: r.escalation_reason, category: r.escalation_category, departmentId: r.escalation_department_id }));

  if (escalations.length < 2) return { scanned: escalations.length, issuesCreated: 0, linked: 0 };

  const clusters = await aiClusterEscalations(escalations);
  const promotable = selectPromotableClusters(clusters, new Set(escalations.map((e) => e.sessionId)));

  let issuesCreated = 0;
  let linked = 0;
  for (const cluster of promotable) {
    if (await createIssueForCluster(supabase, cluster, escalations)) {
      issuesCreated++;
      linked += cluster.sessionIds.length;
    }
  }
  return { scanned: escalations.length, issuesCreated, linked };
}
