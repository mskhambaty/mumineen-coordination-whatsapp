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
    expect(r).toMatchObject({ majlisNum: 5, wantsTazyeen: true });
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
