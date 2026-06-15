import { describe, expect, it } from "vitest";

import { buildAllUpWhatsappSummary } from "@/lib/digest/run";
import type { AllUpExtras, DeptMetrics } from "@/lib/digest/aggregate";

function dept(overrides: Partial<DeptMetrics>): DeptMetrics {
  return {
    department_id: "d",
    department_name: "Dept",
    feedback: { total: 0, positive: 0, neutral: 0, negative: 0, samples: [] },
    issues: 0,
    new_issue_samples: [],
    escalations: 0,
    escalation_samples: [],
    open_tickets: 0,
    open_ticket_details: [],
    ...overrides,
  };
}

const extras: AllUpExtras = { questions_flagged: 0, untriaged_issues: 0, total_open_tickets: 0 };

describe("buildAllUpWhatsappSummary", () => {
  it("adds a few per-department lines for departments with issues", () => {
    const summary = buildAllUpWhatsappSummary(
      "Overall mixed day.",
      [
        dept({ department_id: "p", department_name: "Parking", open_tickets: 3, open_ticket_details: [{ title: "Gate jam", priority: "high", status: "open" }] }),
        dept({ department_id: "m", department_name: "Mawaid", issues: 2, new_issue_samples: [{ title: "Serving delay", priority: "high" }] }),
        dept({ department_id: "g", department_name: "General", feedback: { total: 8, positive: 7, neutral: 1, negative: 0, samples: [] } }),
      ],
      { ...extras, total_open_tickets: 5 },
    );

    expect(summary).toContain("Departments needing attention:");
    expect(summary).toContain("Parking: 3 open — Gate jam");
    expect(summary).toContain("Mawaid: 2 new — Serving delay");
    expect(summary).not.toContain("General:");
  });

  it("keeps message bounded and includes overflow marker when many departments have issues", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      dept({
        department_id: `d${i}`,
        department_name: `Department ${i}`,
        open_tickets: 2,
        open_ticket_details: [{ title: `Issue ${i}`.repeat(5), priority: "high", status: "open" }],
      }),
    );
    const summary = buildAllUpWhatsappSummary("Busy day overall.", many, { ...extras, untriaged_issues: 2 });

    expect(summary.length).toBeLessThanOrEqual(900);
    expect(summary).toContain("Untriaged agent issues: 2");
    expect(summary).toContain("more departments with issues");
  });
});
