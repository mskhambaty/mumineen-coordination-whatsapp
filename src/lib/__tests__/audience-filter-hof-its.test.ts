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
