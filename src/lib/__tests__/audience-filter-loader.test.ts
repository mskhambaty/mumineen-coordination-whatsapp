import { beforeEach, describe, expect, it, vi } from "vitest";

// Verifies loadRoster() attaches the per-phone behavioral aggregates (phone_message_stats /
// phone_tool_usage / phone_template_sends) onto each roster row by whatsapp_e164, so the Engagement
// and set fields resolve through runFilter. Chainable Supabase mock: every builder method returns
// itself; .range/.then resolve to the rows stashed for that table (filters ignored — the rule engine
// applies the logic).
const state = vi.hoisted(() => ({
  mumineen: [] as unknown[],
  families: [] as unknown[],
  phone_message_stats: [] as unknown[],
  phone_tool_usage: [] as unknown[],
  phone_template_sends: [] as unknown[],
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from: (table: keyof typeof state) => {
      const result = () => ({ data: state[table] ?? [], error: null });
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        not: () => builder,
        gte: () => builder,
        like: () => builder,
        order: () => builder,
        range: () => Promise.resolve(result()),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve),
      };
      return builder;
    },
  }),
}));

import { runFilter, type RuleGroup } from "@/lib/whatsapp/audience-filter";

const HOUR = 3600 * 1000;
const hoursAgo = (h: number) => new Date(Date.now() - h * HOUR).toISOString();

beforeEach(() => {
  state.mumineen = [];
  state.families = [];
  state.phone_message_stats = [];
  state.phone_tool_usage = [];
  state.phone_template_sends = [];
});

const PHONE = "+13125550001";

describe("loadRoster behavioral aggregate mapping", () => {
  beforeEach(() => {
    state.mumineen = [{ id: "m1", its: "10000001", whatsapp_e164: PHONE, is_head: true }];
    state.phone_message_stats = [{ phone_e164: PHONE, inbound_count: 3, outbound_count: 1, last_inbound_at: hoursAgo(2), last_outbound_at: hoursAgo(1) }];
    state.phone_tool_usage = [{ phone_e164: PHONE, tool_name: "report_lost_item", last_used_at: hoursAgo(2) }];
    state.phone_template_sends = [{ phone_e164: PHONE, template_code: "registration_reminder", last_sent_at: hoursAgo(50) }];
  });

  const onlyPhone = async (rules: RuleGroup) => (await runFilter(rules)).map((r) => r.whatsapp_e164);

  it("maps message stats so Engagement fields match", async () => {
    expect(await onlyPhone({ combinator: "and", rules: [{ field: "has_messaged_us", operator: "=", value: true }] })).toEqual([PHONE]);
    expect(await onlyPhone({ combinator: "and", rules: [{ field: "hours_since_last_inbound", operator: "<=", value: 6 }] })).toEqual([PHONE]);
    expect(await onlyPhone({ combinator: "and", rules: [{ field: "inbound_message_count", operator: ">=", value: 3 }] })).toEqual([PHONE]);
  });

  it("maps tool usage so a recency-windowed tools_used rule matches", async () => {
    expect(await onlyPhone({ combinator: "and", rules: [{ field: "tools_used", operator: "in", value: { items: ["report_lost_item"], withinHours: 6 } }] })).toEqual([PHONE]);
    // used 2h ago -> NOT outside a 1h window
    expect(await onlyPhone({ combinator: "and", rules: [{ field: "tools_used", operator: "in", value: { items: ["report_lost_item"], withinHours: 1 } }] })).toEqual([]);
  });

  it("maps template sends so 'not sent within 48h' includes a >48h send", async () => {
    expect(await onlyPhone({ combinator: "and", rules: [{ field: "templates_sent", operator: "notIn", value: { items: ["registration_reminder"], withinHours: 48 } }] })).toEqual([PHONE]);
    expect(await onlyPhone({ combinator: "and", rules: [{ field: "templates_sent", operator: "in", value: { items: ["registration_reminder"], withinHours: 48 } }] })).toEqual([]);
  });

  it("defaults to empty/zero when a phone has no behavioral rows", async () => {
    state.phone_message_stats = [];
    state.phone_tool_usage = [];
    state.phone_template_sends = [];
    expect(await onlyPhone({ combinator: "and", rules: [{ field: "has_messaged_us", operator: "=", value: false }] })).toEqual([PHONE]);
    expect(await onlyPhone({ combinator: "and", rules: [{ field: "tools_used", operator: "notIn", value: { items: ["report_lost_item"], withinHours: 6 } }] })).toEqual([PHONE]);
  });
});
