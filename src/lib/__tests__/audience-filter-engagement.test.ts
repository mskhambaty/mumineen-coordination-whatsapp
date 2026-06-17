import { describe, expect, it } from "vitest";

import { evaluate, validateRules, type RosterRow, type Rule } from "@/lib/whatsapp/audience-filter";

// Behavioral filter fields: Engagement (messaging) bool/number fields and the recency-windowed `set`
// fields (AI tool usage, Template history). These evaluate against per-row data attached in
// loadRoster() from the phone_* aggregate views; here we set that data on the fixture directly.

const HOUR = 3600 * 1000;
const hoursAgo = (h: number) => new Date(Date.now() - h * HOUR).toISOString();

function row(overrides: Partial<RosterRow>): RosterRow {
  return {
    mumin_id: "m1", family_id: "f1", its: "10000001", full_name: "Test", gender: "M", age: 30,
    is_adult: true, is_head: false, hof_its: null, jamaat: null, idara: null, category: null,
    venue: null, city: null, local_mehman: null, whatsapp_e164: "+13125550001",
    whatsapp_link_clicked: null, arrival_at: null, departure_at: null, airport: null,
    rahat_seating: null, wheelchair: null, special_needs: null, wants_khidmat: null, khidmat_count: 0,
    not_attending: false, registration_status: null, acc_type: null, open_to_utaro: null, transport_mode: null,
    has_child_under_7: false,
    inbound_count: 0, outbound_count: 0, last_inbound_at: null, last_outbound_at: null,
    tool_last_used: {}, template_last_sent: {},
    ...overrides,
  };
}

describe("Engagement (messaging) fields", () => {
  it("hours_since_last_inbound ≤ N matches recent inbound, not stale, not never", () => {
    const rule: Rule = { field: "hours_since_last_inbound", operator: "<=", value: 24 };
    expect(evaluate(rule, row({ last_inbound_at: hoursAgo(23) }))).toBe(true);
    expect(evaluate(rule, row({ last_inbound_at: hoursAgo(25) }))).toBe(false);
    expect(evaluate(rule, row({ last_inbound_at: null }))).toBe(false); // never -> sentinel excludes
  });

  it("hours_since_last_inbound > N includes never-messaged (sentinel) and stale, excludes recent", () => {
    const rule: Rule = { field: "hours_since_last_inbound", operator: ">", value: 24 };
    expect(evaluate(rule, row({ last_inbound_at: null }))).toBe(true); // never -> include in "haven't in 24h"
    expect(evaluate(rule, row({ last_inbound_at: hoursAgo(25) }))).toBe(true);
    expect(evaluate(rule, row({ last_inbound_at: hoursAgo(1) }))).toBe(false);
  });

  it("has_messaged_us reflects inbound presence", () => {
    const rule: Rule = { field: "has_messaged_us", operator: "=", value: false };
    expect(evaluate(rule, row({ inbound_count: 0 }))).toBe(true); // cold contact
    expect(evaluate(rule, row({ inbound_count: 2 }))).toBe(false);
  });

  it("no_reply_from_them = we sent ≥1 and they have zero inbound", () => {
    const rule: Rule = { field: "no_reply_from_them", operator: "=", value: true };
    expect(evaluate(rule, row({ outbound_count: 1, last_outbound_at: hoursAgo(2), inbound_count: 0 }))).toBe(true);
    expect(evaluate(rule, row({ outbound_count: 1, last_outbound_at: hoursAgo(2), inbound_count: 1 }))).toBe(false); // they replied
    expect(evaluate(rule, row({ outbound_count: 0, last_outbound_at: null, inbound_count: 0 }))).toBe(false); // we never messaged
  });

  it("inbound_message_count ≥ N at the boundary", () => {
    const rule: Rule = { field: "inbound_message_count", operator: ">=", value: 5 };
    expect(evaluate(rule, row({ inbound_count: 5 }))).toBe(true);
    expect(evaluate(rule, row({ inbound_count: 4 }))).toBe(false);
  });
});

describe("set fields with recency window (AI tool usage / Template history)", () => {
  it("validateRules rejects empty items and bad window, accepts a good value", () => {
    expect(validateRules({ field: "tools_used", operator: "in", value: { items: [], withinHours: 6 } })).toMatch(/at least one/);
    expect(validateRules({ field: "tools_used", operator: "in", value: { items: ["report_lost_item"], withinHours: -1 } })).toMatch(/time window/);
    expect(validateRules({ field: "tools_used", operator: "in", value: { items: ["report_lost_item"], withinHours: 6 } })).toBeNull();
    expect(validateRules({ field: "tools_used", operator: "in", value: { items: ["report_lost_item"], withinHours: null } })).toBeNull();
  });

  it("tools_used 'in' honors the recency window", () => {
    const rule: Rule = { field: "tools_used", operator: "in", value: { items: ["report_lost_item"], withinHours: 6 } };
    expect(evaluate(rule, row({ tool_last_used: { report_lost_item: hoursAgo(2) } }))).toBe(true);
    expect(evaluate(rule, row({ tool_last_used: { report_lost_item: hoursAgo(10) } }))).toBe(false); // outside window
    expect(evaluate(rule, row({ tool_last_used: {} }))).toBe(false); // never used
  });

  it("tools_used 'in' with null window means ever-used", () => {
    const rule: Rule = { field: "tools_used", operator: "in", value: { items: ["report_lost_item"], withinHours: null } };
    expect(evaluate(rule, row({ tool_last_used: { report_lost_item: hoursAgo(500) } }))).toBe(true);
    expect(evaluate(rule, row({ tool_last_used: {} }))).toBe(false);
  });

  it("tools_used 'notIn' covers never-used AND used-before-window", () => {
    const rule: Rule = { field: "tools_used", operator: "notIn", value: { items: ["report_lost_item"], withinHours: 6 } };
    expect(evaluate(rule, row({ tool_last_used: {} }))).toBe(true); // never used
    expect(evaluate(rule, row({ tool_last_used: { report_lost_item: hoursAgo(10) } }))).toBe(true); // used, but >6h ago
    expect(evaluate(rule, row({ tool_last_used: { report_lost_item: hoursAgo(2) } }))).toBe(false); // used recently
  });

  it("templates_sent 'notIn' within 48h finds people not recently sent X", () => {
    const rule: Rule = { field: "templates_sent", operator: "notIn", value: { items: ["registration_reminder"], withinHours: 48 } };
    expect(evaluate(rule, row({ template_last_sent: { registration_reminder: hoursAgo(50) } }))).toBe(true); // sent, but >48h
    expect(evaluate(rule, row({ template_last_sent: {} }))).toBe(true); // never sent
    expect(evaluate(rule, row({ template_last_sent: { registration_reminder: hoursAgo(10) } }))).toBe(false); // recently sent
  });

  it("'in' matches any of several selected items", () => {
    const rule: Rule = { field: "tools_used", operator: "in", value: { items: ["report_lost_item", "move_to_escalation"], withinHours: null } };
    expect(evaluate(rule, row({ tool_last_used: { move_to_escalation: hoursAgo(1) } }))).toBe(true);
  });
});
