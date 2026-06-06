import { describe, expect, it } from "vitest";

import { ALWAYS_ON_RULES, buildSystemPrompt } from "@/lib/agent/run-agent";
import type { CallerContext } from "@/lib/api/auth";

const BASE_PROMPT = "## Base system prompt — you are the assistant.";
const DEPARTMENTS = "\n\n## Available Departments\n- Follow-up: general follow-ups\n- Accommodation: hotels and utaro";
const SENDER_MARKER = "## Sender Context";

function caller(overrides: Partial<CallerContext> = {}): CallerContext {
  return {
    user_id: "user-1",
    display_name: "Test User",
    role: "visitor",
    global_role: "member",
    can_read_all: false,
    can_write_all: false,
    departments: [],
    ...overrides,
  };
}

describe("buildSystemPrompt ordering (prompt-cache prefix)", () => {
  it("places base prompt, departments, and every always-on rule BEFORE Sender Context", () => {
    const prompt = buildSystemPrompt({
      basePrompt: BASE_PROMPT,
      departmentSection: DEPARTMENTS,
      callerContext: caller(),
      phoneE164: "+15551234567",
      role: "visitor",
    });

    const senderIdx = prompt.indexOf(SENDER_MARKER);
    expect(senderIdx).toBeGreaterThan(-1);

    // Static, user-independent content must all come before the per-user block.
    expect(prompt.indexOf(BASE_PROMPT)).toBeLessThan(senderIdx);
    expect(prompt.indexOf(DEPARTMENTS)).toBeLessThan(senderIdx);
    for (const rule of ALWAYS_ON_RULES) {
      const idx = prompt.indexOf(rule.text);
      expect(idx, `rule ${rule.name} must appear before Sender Context`).toBeGreaterThan(-1);
      expect(idx).toBeLessThan(senderIdx);
    }
  });

  it("produces an identical static prefix across different callers (cross-user cache)", () => {
    const common = {
      basePrompt: BASE_PROMPT,
      departmentSection: DEPARTMENTS,
      phoneE164: "+15550000000",
      role: "visitor" as const,
    };

    const visitorPrompt = buildSystemPrompt({ ...common, callerContext: caller() });
    const adminPrompt = buildSystemPrompt({
      ...common,
      callerContext: caller({
        role: "admin",
        global_role: "leadership_admin",
        can_read_all: true,
        can_write_all: true,
        departments: [{ department_id: "d1", department_name: "Accommodation", dept_role: "hod" }],
      }),
    });

    const prefix = (p: string) => p.slice(0, p.indexOf(SENDER_MARKER));
    // Everything up to Sender Context is byte-identical → one shared cache prefix.
    expect(prefix(visitorPrompt)).toBe(prefix(adminPrompt));
    // ...and the per-user tail genuinely differs.
    expect(visitorPrompt).not.toBe(adminPrompt);
  });

  it("includes every always-on rule's full text (no content dropped by reorder)", () => {
    const prompt = buildSystemPrompt({
      basePrompt: BASE_PROMPT,
      departmentSection: DEPARTMENTS,
      callerContext: caller(),
      phoneE164: "+15551234567",
      role: "visitor",
    });
    for (const rule of ALWAYS_ON_RULES) {
      expect(prompt).toContain(rule.text);
    }
  });

  it("still emits Sender Context when no caller context resolved", () => {
    const prompt = buildSystemPrompt({
      basePrompt: BASE_PROMPT,
      departmentSection: "",
      callerContext: undefined,
      phoneE164: "+15551234567",
      role: "visitor",
    });
    expect(prompt).toContain(SENDER_MARKER);
    expect(prompt).toContain("Global access: unknown");
  });
});
