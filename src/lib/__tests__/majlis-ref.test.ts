import { describe, expect, it } from "vitest";

import { parseMajlisRef } from "@/lib/knowledge/religious-topics";

describe("parseMajlisRef", () => {
  it("parses ordinal-word majlis references", () => {
    const r = parseMajlisRef("What was the second waaz of 1447 ashara about?");
    expect(r).toMatchObject({ majlisNum: 2, lailat: false, wantsTazyeen: false, year: "1447" });
  });

  it("parses 'Majlis N' and 'Nth majlis'", () => {
    expect(parseMajlisRef("topic of Majlis 3")?.majlisNum).toBe(3);
    expect(parseMajlisRef("the 8th majlis")?.majlisNum).toBe(8);
    expect(parseMajlisRef("first waaz")?.majlisNum).toBe(1);
  });

  it("maps day-of-Muharram to the right majlis (Majlis N = (N+1)th Muharram)", () => {
    expect(parseMajlisRef("the waaz on 4th Muharram")?.majlisNum).toBe(3);
    expect(parseMajlisRef("2nd Muharram waaz")?.majlisNum).toBe(1);
  });

  it("routes Tazyeen/decoration questions to the Tazyeen block", () => {
    const r = parseMajlisRef("What was the Tazyeen / decoration for Majlis 5?");
    expect(r).toMatchObject({ majlisNum: 5, wantsTazyeen: true, wantsDars: false });
  });

  it("routes Al-Dars / duroos / chapter questions to the Al-Dars block", () => {
    expect(parseMajlisRef("al-dars majlis 1")).toMatchObject({ majlisNum: 1, wantsDars: true });
    expect(parseMajlisRef("what were the 5 duroos of majlis 1")).toMatchObject({ majlisNum: 1, wantsDars: true });
    expect(parseMajlisRef("majlis 1 chapter 2 learning canvas")).toMatchObject({ majlisNum: 1, wantsDars: true });
  });

  it("does not flag wantsDars for plain reflection/tazyeen queries", () => {
    expect(parseMajlisRef("topic of Majlis 3")?.wantsDars).toBe(false);
    expect(parseMajlisRef("the second waaz of 1447 ashara")?.wantsDars).toBe(false);
    expect(parseMajlisRef("Tazyeen for Majlis 5")?.wantsDars).toBe(false);
  });

  it("detects the daily micro-categories (jumla / kalema / unwaan)", () => {
    expect(parseMajlisRef("jumla of majlis 2")).toMatchObject({ majlisNum: 2, wantsCategory: "jumla" });
    expect(parseMajlisRef("majlis 3 kalema")).toMatchObject({ majlisNum: 3, wantsCategory: "kalema" });
    expect(parseMajlisRef("unwaan for majlis 4")).toMatchObject({ majlisNum: 4, wantsCategory: "unwaan" });
    expect(parseMajlisRef("reflection of majlis 1")?.wantsCategory).toBeNull();
  });

  it("maps Lailat / Ashura / Majlis 9-10 to the combined block", () => {
    expect(parseMajlisRef("Lailat al-Aashura reflection")?.lailat).toBe(true);
    const m910 = parseMajlisRef("Majlis 9");
    expect(m910?.lailat).toBe(true);
    expect(m910?.majlisNum).toBeNull();
  });

  it("returns null when no specific majlis is referenced", () => {
    expect(parseMajlisRef("what does aab mean")).toBeNull();
    expect(parseMajlisRef("which hotels have a shuttle")).toBeNull();
  });
});
