import { describe, expect, it } from "vitest";

import { VIP_IDARAS, vipGroup } from "@/lib/registration/vip";

describe("vipGroup", () => {
  it("returns the category when present — the category tier wins over a qualifying idara", () => {
    expect(vipGroup({ category: "Baite Zainy", idara: "Ummal Kiram" })).toBe("Baite Zainy");
  });

  it("returns a qualifying idara when there is no usable category", () => {
    expect(vipGroup({ category: null, idara: "Attalimiyah" })).toBe("Attalimiyah");
    expect(vipGroup({ category: "  ", idara: "Aljamea KHDGZ" })).toBe("Aljamea KHDGZ");
  });

  it("returns null for a non-VIP idara with no category", () => {
    expect(vipGroup({ category: null, idara: "Muntasebeen" })).toBeNull();
    expect(vipGroup({ category: null, idara: null })).toBeNull();
  });

  it("normalizes a trailing parenthetical qualifier to the base idara (e.g. 'Attalimiyah (WH)')", () => {
    expect(vipGroup({ category: null, idara: "Attalimiyah (WH)" })).toBe("Attalimiyah");
    expect(vipGroup({ category: null, idara: "Azwaaj_Attalimiyah (WH)" })).toBe("Azwaaj_Attalimiyah");
  });

  it("still returns null when the base (sans parenthetical) is not a VIP idara", () => {
    expect(vipGroup({ category: null, idara: "Badri Mahal Staff (X)" })).toBeNull();
  });

  it("treats every value in VIP_IDARAS as a VIP group", () => {
    for (const idara of VIP_IDARAS) {
      expect(vipGroup({ category: null, idara })).toBe(idara);
    }
  });
});
