import { getSupabaseAdmin } from "@/lib/supabase/server";

type Supa = ReturnType<typeof getSupabaseAdmin>;

// Per-link episode lifecycle for issue_escalation_links. A conversation can be linked to several
// issues over time (one per episode); each link resolves independently, and an issue auto-closes
// when all its links are resolved (auto-reopens when a fresh open link is added).

// Mark a conversation's currently-OPEN issue links as resolved (its current episode is done).
// In practice a conversation has at most one open link — past episodes are already resolved.
// Returns the affected issue ids so the caller can sync their status.
export async function resolveOpenLinksForSession(
  supabase: Supa,
  sessionId: string,
  resolvedBy?: string | null,
): Promise<string[]> {
  const { data } = await supabase
    .from("issue_escalation_links")
    .update({ status: "resolved", resolved_at: new Date().toISOString(), resolved_by: resolvedBy ?? null })
    .eq("conversation_session_id", sessionId)
    .eq("status", "open")
    .select("issue_id");
  return [...new Set(((data ?? []) as { issue_id: string }[]).map((r) => r.issue_id))];
}

// Mark every open link of an issue resolved (used by issue bulk-resolve).
export async function resolveAllLinksForIssue(
  supabase: Supa,
  issueId: string,
  resolvedBy?: string | null,
): Promise<void> {
  await supabase
    .from("issue_escalation_links")
    .update({ status: "resolved", resolved_at: new Date().toISOString(), resolved_by: resolvedBy ?? null })
    .eq("issue_id", issueId)
    .eq("status", "open");
}

// Auto-close / auto-reopen an issue from its links:
//   - >=1 link and none open, issue not resolved  -> resolve (auto-close)
//   - >=1 open link, issue resolved               -> open   (auto-reopen)
// Otherwise leave the status alone (never clobbers a manual open/in_progress, never touches a
// link-less issue).
export async function syncIssueStatusFromLinks(supabase: Supa, issueId: string): Promise<void> {
  const { data: issue } = await supabase
    .from("issues")
    .select("status")
    .eq("id", issueId)
    .maybeSingle();
  if (!issue) return;

  const { data: links } = await supabase
    .from("issue_escalation_links")
    .select("status")
    .eq("issue_id", issueId);
  const all = (links ?? []) as Array<{ status: string | null }>;
  if (all.length === 0) return;

  const openCount = all.filter((l) => (l.status ?? "open") === "open").length;
  if (openCount === 0 && issue.status !== "resolved") {
    await supabase.from("issues").update({ status: "resolved" }).eq("id", issueId);
  } else if (openCount > 0 && issue.status === "resolved") {
    await supabase.from("issues").update({ status: "open" }).eq("id", issueId);
  }
}

export async function syncIssuesStatusFromLinks(supabase: Supa, issueIds: string[]): Promise<void> {
  for (const id of issueIds) {
    await syncIssueStatusFromLinks(supabase, id);
  }
}
