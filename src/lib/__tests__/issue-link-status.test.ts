import { describe, expect, it } from "vitest";

import { syncIssueStatusFromLinks } from "@/lib/issues/link-status";

// Minimal supabase fake: serves the issue's status + its links' statuses, and records any
// issues.update() the helper performs. The helper takes `supabase` as a param, so no mocking needed.
function makeSupabase(issueStatus: string | null, linkStatuses: Array<string | null>) {
  const updates: Array<Record<string, unknown>> = [];
  const supabase = {
    from(table: string) {
      if (table === "issues") {
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: () => Promise.resolve({ data: issueStatus === null ? null : { status: issueStatus }, error: null }),
          update: (vals: Record<string, unknown>) => ({
            eq: () => {
              updates.push(vals);
              return Promise.resolve({ error: null });
            },
          }),
        };
        return chain;
      }
      // issue_escalation_links
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
          Promise.resolve({ data: linkStatuses.map((s) => ({ status: s })), error: null }).then(res, rej),
      };
      return chain;
    },
  };
  return { supabase: supabase as never, updates };
}

describe("syncIssueStatusFromLinks", () => {
  it("auto-closes an open issue when all links are resolved", async () => {
    const { supabase, updates } = makeSupabase("open", ["resolved", "resolved"]);
    await syncIssueStatusFromLinks(supabase, "iss1");
    expect(updates).toEqual([{ status: "resolved" }]);
  });

  it("auto-reopens a resolved issue when an open link exists", async () => {
    const { supabase, updates } = makeSupabase("resolved", ["resolved", "open"]);
    await syncIssueStatusFromLinks(supabase, "iss1");
    expect(updates).toEqual([{ status: "open" }]);
  });

  it("leaves an open issue with an open link untouched", async () => {
    const { supabase, updates } = makeSupabase("open", ["open", "resolved"]);
    await syncIssueStatusFromLinks(supabase, "iss1");
    expect(updates).toHaveLength(0);
  });

  it("leaves an already-resolved issue with all links resolved untouched", async () => {
    const { supabase, updates } = makeSupabase("resolved", ["resolved"]);
    await syncIssueStatusFromLinks(supabase, "iss1");
    expect(updates).toHaveLength(0);
  });

  it("does not change a link-less issue's status", async () => {
    const { supabase, updates } = makeSupabase("open", []);
    await syncIssueStatusFromLinks(supabase, "iss1");
    expect(updates).toHaveLength(0);
  });
});
