import { describe, expect, it } from "vitest";

import {
  buildHouseholdRow,
  lotPurposesNarrow,
  matchesFilters,
  matchesLotPurposes,
  pickAssignable,
  type HouseholdRow,
  type RollupFamily,
  type RollupMember,
} from "@/lib/parking/rollups";

const family: RollupFamily = { id: "f1", hof_its: "10000001", transport_mode: null };

function member(overrides: Partial<RollupMember> = {}): RollupMember {
  return {
    hof_its: "10000001",
    is_head: false,
    full_name: "Test Member",
    whatsapp_e164: null,
    local_mehman: "Local",
    age: 40,
    category: null,
    rahat_seating: false,
    wheelchair: false,
    ...overrides,
  };
}

describe("buildHouseholdRow", () => {
  it("uses the head for name, phone, and local/mehman", () => {
    const row = buildHouseholdRow(family, [
      member({ full_name: "Spouse", whatsapp_e164: "+1555000222" }),
      member({ is_head: true, full_name: "Head Name", whatsapp_e164: "+1555000111" }),
    ], []);
    expect(row.head_name).toBe("Head Name");
    expect(row.phone).toBe("+1555000111");
    expect(row.local_mehman).toBe("Local");
  });

  it("falls back to any member's phone when the head has none", () => {
    const row = buildHouseholdRow(family, [
      member({ is_head: true, whatsapp_e164: null }),
      member({ whatsapp_e164: "+1555000333" }),
    ], []);
    expect(row.phone).toBe("+1555000333");
  });

  it("marks local households eligible regardless of transport mode", () => {
    const row = buildHouseholdRow(family, [member({ is_head: true, local_mehman: "Local" })], []);
    expect(row.eligible).toBe(true);
  });

  it("marks mehman households eligible only with a rental car", () => {
    const mehman = member({ is_head: true, local_mehman: "Mehman" });
    expect(buildHouseholdRow({ ...family, transport_mode: "rental" }, [mehman], []).eligible).toBe(true);
    expect(buildHouseholdRow({ ...family, transport_mode: "rideshare" }, [mehman], []).eligible).toBe(false);
    expect(buildHouseholdRow(family, [mehman], []).eligible).toBe(false);
  });

  it("counts rahat members (rahat_seating or wheelchair) and seniors separately", () => {
    const row = buildHouseholdRow(family, [
      member({ is_head: true, rahat_seating: true }),
      member({ wheelchair: true }),
      member({ age: 70 }),
    ], []);
    expect(row.rahat_count).toBe(2);
    expect(row.senior_count).toBe(1);
  });

  it("counts wheelchair members separately from rahat seating", () => {
    const row = buildHouseholdRow(family, [
      member({ is_head: true, rahat_seating: true }),
      member({ wheelchair: true }),
      member({ wheelchair: true, rahat_seating: true }),
    ], []);
    expect(row.wheelchair_count).toBe(2);
    expect(row.rahat_count).toBe(3);
  });

  it("flags all_rahat only when every member has rahat seating or a wheelchair", () => {
    expect(buildHouseholdRow(family, [
      member({ is_head: true, rahat_seating: true }),
      member({ wheelchair: true }),
    ], []).all_rahat).toBe(true);
    expect(buildHouseholdRow(family, [
      member({ is_head: true, rahat_seating: true }),
      member(),
    ], []).all_rahat).toBe(false);
    expect(buildHouseholdRow(family, [], []).all_rahat).toBe(false);
  });

  it("flags all_65_plus only when every member is 65+, treating null ages as under", () => {
    expect(buildHouseholdRow(family, [member({ is_head: true, age: 66 }), member({ age: 70 })], []).all_65_plus).toBe(true);
    expect(buildHouseholdRow(family, [member({ is_head: true, age: 66 }), member({ age: 40 })], []).all_65_plus).toBe(false);
    expect(buildHouseholdRow(family, [member({ is_head: true, age: 66 }), member({ age: null })], []).all_65_plus).toBe(false);
  });

  it("counts kids under 7 and ignores null ages", () => {
    const row = buildHouseholdRow(family, [
      member({ is_head: true }),
      member({ age: 3 }),
      member({ age: 6 }),
      member({ age: 7 }),
      member({ age: null }),
    ], []);
    expect(row.kids_under_7).toBe(2);
  });

  it("collects distinct non-null categories", () => {
    const row = buildHouseholdRow(family, [
      member({ is_head: true, category: "VIP" }),
      member({ category: "VIP" }),
      member({ category: null }),
    ], []);
    expect(row.categories).toEqual(["VIP"]);
  });
});

describe("matchesFilters", () => {
  function row(overrides: Partial<HouseholdRow> = {}): HouseholdRow {
    return {
      family_id: "f1",
      hof_its: "10000001",
      head_name: "Head Name",
      phone: null,
      local_mehman: "Local",
      transport_mode: null,
      member_count: 2,
      eligible: true,
      rahat_count: 0,
      wheelchair_count: 0,
      senior_count: 0,
      all_65_plus: false,
      all_rahat: false,
      categories: [],
      kids_under_7: 0,
      passes: [],
      ...overrides,
    };
  }

  it("eligible filter drops ineligible rows", () => {
    expect(matchesFilters(row({ eligible: false }), { eligible: true })).toBe(false);
    expect(matchesFilters(row({ eligible: false }), {})).toBe(true);
  });

  it("rahat_senior passes when the household has a rahat member OR a senior", () => {
    expect(matchesFilters(row({ rahat_count: 1 }), { rahat_senior: true })).toBe(true);
    expect(matchesFilters(row({ senior_count: 1 }), { rahat_senior: true })).toBe(true);
    expect(matchesFilters(row(), { rahat_senior: true })).toBe(false);
  });

  it("all_65 requires the whole-household flag", () => {
    expect(matchesFilters(row({ all_65_plus: true }), { all_65: true })).toBe(true);
    expect(matchesFilters(row({ senior_count: 1 }), { all_65: true })).toBe(false);
  });

  it("all_rahat requires the whole-household flag", () => {
    expect(matchesFilters(row({ all_rahat: true }), { all_rahat: true })).toBe(true);
    expect(matchesFilters(row({ rahat_count: 1 }), { all_rahat: true })).toBe(false);
  });

  it("wheelchair filter requires at least one wheelchair member", () => {
    expect(matchesFilters(row({ wheelchair_count: 1 }), { wheelchair: true })).toBe(true);
    expect(matchesFilters(row({ rahat_count: 1 }), { wheelchair: true })).toBe(false);
    expect(matchesFilters(row(), { wheelchair: false })).toBe(true);
  });

  it("has_phone filter requires a phone number", () => {
    expect(matchesFilters(row({ phone: "+16305550100" }), { has_phone: true })).toBe(true);
    expect(matchesFilters(row({ phone: null }), { has_phone: true })).toBe(false);
    expect(matchesFilters(row({ phone: null }), {})).toBe(true);
  });

  it("has_category filter requires any member category value", () => {
    expect(matchesFilters(row({ categories: ["VIP"] }), { has_category: true })).toBe(true);
    expect(matchesFilters(row({ categories: ["Sahebo"] }), { has_category: true })).toBe(true);
    expect(matchesFilters(row(), { has_category: true })).toBe(false);
    expect(matchesFilters(row(), {})).toBe(true);
  });

  it("assigned/unassigned filter checks pass count", () => {
    const pass = { id: "p1", lot_id: "l1", lot_name: "Masjid", lot_color: "Blue", notes: null };
    expect(matchesFilters(row({ passes: [pass] }), { assigned: "assigned" })).toBe(true);
    expect(matchesFilters(row({ passes: [pass] }), { assigned: "unassigned" })).toBe(false);
    expect(matchesFilters(row(), { assigned: "unassigned" })).toBe(true);
  });

  it("name search is case-insensitive substring on the head name", () => {
    expect(matchesFilters(row(), { q: "head" })).toBe(true);
    expect(matchesFilters(row(), { q: "xyz" })).toBe(false);
  });

  it("kids_under_7 and local_mehman filters", () => {
    expect(matchesFilters(row({ kids_under_7: 1 }), { kids_under_7: true })).toBe(true);
    expect(matchesFilters(row(), { kids_under_7: true })).toBe(false);
    expect(matchesFilters(row(), { local_mehman: "Mehman" })).toBe(false);
    expect(matchesFilters(row(), { local_mehman: "Local" })).toBe(true);
  });
});

describe("matchesLotPurposes", () => {
  function row(overrides: Partial<HouseholdRow> = {}): HouseholdRow {
    return {
      family_id: "f1",
      hof_its: "10000001",
      head_name: "Head Name",
      phone: null,
      local_mehman: "Local",
      transport_mode: null,
      member_count: 2,
      eligible: true,
      rahat_count: 0,
      wheelchair_count: 0,
      senior_count: 0,
      all_65_plus: false,
      all_rahat: false,
      categories: [],
      kids_under_7: 0,
      passes: [],
      ...overrides,
    };
  }

  it("vip_incapacitated matches a category value or any rahat member", () => {
    expect(matchesLotPurposes(row({ categories: ["VIP"] }), ["vip_incapacitated"])).toBe(true);
    expect(matchesLotPurposes(row({ rahat_count: 1 }), ["vip_incapacitated"])).toBe(true);
    expect(matchesLotPurposes(row(), ["vip_incapacitated"])).toBe(false);
  });

  it("foreign_mehman matches mehman households regardless of transport", () => {
    expect(matchesLotPurposes(row({ local_mehman: "Mehman" }), ["foreign_mehman"])).toBe(true);
    expect(matchesLotPurposes(row({ local_mehman: "Local" }), ["foreign_mehman"])).toBe(false);
  });

  it("all_65_plus matches the whole-household senior flag", () => {
    expect(matchesLotPurposes(row({ all_65_plus: true }), ["all_65_plus"])).toBe(true);
    expect(matchesLotPurposes(row({ senior_count: 1 }), ["all_65_plus"])).toBe(false);
  });

  it("chicago matches local households", () => {
    expect(matchesLotPurposes(row({ local_mehman: "Local" }), ["chicago"])).toBe(true);
    expect(matchesLotPurposes(row({ local_mehman: "Mehman" }), ["chicago"])).toBe(false);
  });

  it("early_khidmat is not data-derivable, so everyone qualifies", () => {
    expect(matchesLotPurposes(row(), ["early_khidmat"])).toBe(true);
  });

  it("a household qualifies when it matches ANY of the lot's purposes", () => {
    expect(matchesLotPurposes(row({ local_mehman: "Mehman" }), ["chicago", "foreign_mehman"])).toBe(true);
    expect(matchesLotPurposes(row({ local_mehman: "Mehman" }), ["chicago", "all_65_plus"])).toBe(false);
  });

  it("a lot with no purposes (or an unknown purpose) accepts everyone", () => {
    expect(matchesLotPurposes(row(), [])).toBe(true);
    expect(matchesLotPurposes(row(), ["something_new"])).toBe(true);
  });
});

describe("lotPurposesNarrow", () => {
  it("is true only when every purpose carries a data check", () => {
    expect(lotPurposesNarrow(["chicago"])).toBe(true);
    expect(lotPurposesNarrow(["vip_incapacitated", "all_65_plus"])).toBe(true);
    expect(lotPurposesNarrow(["foreign_mehman"])).toBe(true);
  });

  it("is false when any purpose accepts everyone (OR semantics)", () => {
    expect(lotPurposesNarrow([])).toBe(false);
    expect(lotPurposesNarrow(["early_khidmat"])).toBe(false);
    expect(lotPurposesNarrow(["chicago", "early_khidmat"])).toBe(false);
    expect(lotPurposesNarrow(["something_new"])).toBe(false);
  });
});

describe("pickAssignable", () => {
  const masjidPass = { id: "p1", lot_id: "lot-masjid", lot_name: "Masjid", lot_color: "Blue", notes: null };

  function row(familyId: string, passes: HouseholdRow["passes"] = []): HouseholdRow {
    return {
      family_id: familyId,
      hof_its: familyId,
      head_name: familyId,
      phone: null,
      local_mehman: "Local",
      transport_mode: null,
      member_count: 1,
      eligible: true,
      rahat_count: 0,
      wheelchair_count: 0,
      senior_count: 0,
      all_65_plus: false,
      all_rahat: false,
      categories: [],
      kids_under_7: 0,
      passes,
    };
  }

  it("picks the first N households in display order", () => {
    const rows = [row("f1"), row("f2"), row("f3")];
    expect(pickAssignable(rows, "lot-masjid", 2)).toEqual(["f1", "f2"]);
  });

  it("skips households already holding a pass in that lot", () => {
    const rows = [row("f1", [masjidPass]), row("f2"), row("f3")];
    expect(pickAssignable(rows, "lot-masjid", 2)).toEqual(["f2", "f3"]);
  });

  it("does not skip households whose passes are in other lots", () => {
    const otherPass = { ...masjidPass, lot_id: "lot-buddha", lot_name: "Buddha" };
    const rows = [row("f1", [otherPass]), row("f2")];
    expect(pickAssignable(rows, "lot-masjid", 2)).toEqual(["f1", "f2"]);
  });

  it("returns fewer than N when not enough assignable households exist", () => {
    const rows = [row("f1", [masjidPass]), row("f2")];
    expect(pickAssignable(rows, "lot-masjid", 5)).toEqual(["f2"]);
  });

  it("returns empty for a zero or negative count", () => {
    const rows = [row("f1"), row("f2")];
    expect(pickAssignable(rows, "lot-masjid", 0)).toEqual([]);
    expect(pickAssignable(rows, "lot-masjid", -3)).toEqual([]);
  });
});
