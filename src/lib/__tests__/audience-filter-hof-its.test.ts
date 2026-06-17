import { describe, expect, it } from "vitest";

import { evaluate, validateRules, type RosterRow, type Rule } from "@/lib/whatsapp/audience-filter";

// HOF ITS (`hof_its`) is a text field in FIELD_CATALOG so an operator can target a whole family by
// the head-of-family's ITS id (e.g. "HOF ITS = 12345678").

function row(overrides: Partial<RosterRow>): RosterRow {
  return {
    mumin_id: "m1",
    family_id: "f1",
    its: "10000001",
    full_name: "Test Member",
    gender: "M",
    age: 30,
    is_adult: true,
    is_head: false,
    hof_its: null,
    jamaat: null,
    idara: null,
    category: null,
    venue: null,
    city: null,
    local_mehman: null,
    whatsapp_e164: "+13125550001",
    whatsapp_link_clicked: null,
    arrival_at: null,
    departure_at: null,
    airport: null,
    rahat_seating: null,
    wheelchair: null,
    special_needs: null,
    wants_khidmat: null,
    khidmat_count: 0,
    not_attending: false,
    registration_status: null,
    acc_type: null,
    open_to_utaro: null,
    transport_mode: null,
    has_child_under_7: false,
    inbound_count: 0,
    outbound_count: 0,
    last_inbound_at: null,
    last_outbound_at: null,
    tool_last_used: {},
    template_last_sent: {},
    ...overrides,
  };
}

describe("hof_its custom-filter field", () => {
  it("validateRules accepts an equals rule on hof_its", () => {
    const rule: Rule = { field: "hof_its", operator: "=", value: "12345678" };
    expect(validateRules(rule)).toBeNull();
  });

  it("evaluate matches a member whose HOF ITS equals the value", () => {
    const rule: Rule = { field: "hof_its", operator: "=", value: "12345678" };
    expect(evaluate(rule, row({ hof_its: "12345678" }))).toBe(true);
    expect(evaluate(rule, row({ hof_its: "99999999" }))).toBe(false);
  });

  it("evaluate supports contains on hof_its", () => {
    const rule: Rule = { field: "hof_its", operator: "contains", value: "1234" };
    expect(evaluate(rule, row({ hof_its: "12345678" }))).toBe(true);
    expect(evaluate(rule, row({ hof_its: "87654321" }))).toBe(false);
  });
});

describe("NOT groups (custom-filter exclusions)", () => {
  // Powers "attending AND NOT (rahat OR wheelchair)" in the survey custom-audience builder, so a
  // broad form doesn't re-survey people already covered by a narrower one.
  const exclude: Rule | { combinator: "and"; rules: unknown[] } = {
    combinator: "and",
    rules: [
      { field: "not_attending", operator: "=", value: false },
      { combinator: "or", not: true, rules: [
        { field: "rahat_seating", operator: "=", value: true },
        { field: "wheelchair", operator: "=", value: true },
      ] },
    ],
  };

  it("excludes rows matching the negated subgroup", () => {
    const q = exclude as Parameters<typeof evaluate>[0];
    expect(evaluate(q, row({ not_attending: false, rahat_seating: false, wheelchair: false }))).toBe(true);
    expect(evaluate(q, row({ not_attending: false, rahat_seating: true, wheelchair: false }))).toBe(false);
    expect(evaluate(q, row({ not_attending: false, rahat_seating: false, wheelchair: true }))).toBe(false);
    expect(evaluate(q, row({ not_attending: true, rahat_seating: false, wheelchair: false }))).toBe(false);
  });
});

describe("independent-combinator groups (mixed AND/OR in one filter)", () => {
  // react-querybuilder IC shape: combinators are interleaved between rules, evaluated left-to-right.
  // e.g. (rahat OR wheelchair) AND attending  ==  [rahat, "or", wheelchair, "and", attending]
  const ic = {
    rules: [
      { field: "rahat_seating", operator: "=", value: true },
      "or",
      { field: "wheelchair", operator: "=", value: true },
      "and",
      { field: "not_attending", operator: "=", value: false },
    ],
  } as unknown as Parameters<typeof evaluate>[0];

  it("evaluates interleaved and/or left-to-right", () => {
    expect(evaluate(ic, row({ rahat_seating: true, wheelchair: false, not_attending: false }))).toBe(true);
    expect(evaluate(ic, row({ rahat_seating: false, wheelchair: true, not_attending: false }))).toBe(true);
    expect(evaluate(ic, row({ rahat_seating: false, wheelchair: false, not_attending: false }))).toBe(false);
    expect(evaluate(ic, row({ rahat_seating: true, wheelchair: true, not_attending: true }))).toBe(false); // not attending
  });

  it("validateRules accepts an IC group and rejects a bad junction", () => {
    expect(validateRules(ic)).toBeNull();
    const bad = { rules: [{ field: "wheelchair", operator: "=", value: true }, "xor", { field: "rahat_seating", operator: "=", value: true }] };
    expect(validateRules(bad)).toBe("Invalid combinator.");
  });
});

describe("has_child_under_7 household field (Atfaal targeting)", () => {
  // The Atfaal group targets ADULTS in young-child households so the survey greets a parent, not
  // the toddler. The field is set per family member in loadRoster; here we just verify the rule.
  it("validateRules accepts an equals rule on has_child_under_7", () => {
    expect(validateRules({ field: "has_child_under_7", operator: "=", value: true })).toBeNull();
  });

  it("matches adults in a young-child household, not the kids", () => {
    const rule: Rule = {
      field: "has_child_under_7", operator: "=", value: true,
    } as Rule;
    const parent = row({ is_adult: true, age: 35, has_child_under_7: true });
    const toddler = row({ is_adult: false, age: 3, has_child_under_7: true });
    const childlessAdult = row({ is_adult: true, age: 40, has_child_under_7: false });
    expect(evaluate(rule, parent)).toBe(true);
    // The flag is true for the toddler too (household-level) — the group ANDs is_adult to exclude it.
    expect(evaluate({ combinator: "and", rules: [rule, { field: "is_adult", operator: "=", value: true }] }, toddler)).toBe(false);
    expect(evaluate({ combinator: "and", rules: [rule, { field: "is_adult", operator: "=", value: true }] }, parent)).toBe(true);
    expect(evaluate(rule, childlessAdult)).toBe(false);
  });
});
