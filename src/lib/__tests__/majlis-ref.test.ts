import { describe, expect, it } from "vitest";

import { isDeepQuery, isOverviewQuery, parseMajlisRef } from "@/lib/knowledge/religious-topics";
import { resolveAsharaYear } from "@/lib/knowledge/ashara-config";

describe("resolveAsharaYear (1447↔1448 disambiguation)", () => {
  const BEFORE = "2026-06-07"; // before Ashara 1448 (starts 2026-06-16)
  const DURING = "2026-06-20";

  it("explicit hijri year wins", () => {
    expect(resolveAsharaYear("topic of majlis 1 in 1447", BEFORE)).toMatchObject({ year: "1447", cue: "explicit" });
    expect(resolveAsharaYear("majlis 4 ashara 1448H", BEFORE)).toMatchObject({ year: "1448", cue: "explicit" });
  });

  it("'this year / today / this Ashara' resolve to the active event (1448)", () => {
    expect(resolveAsharaYear("what was the theme of Majlis 7 this Ashara?", BEFORE)).toMatchObject({ year: "1448", cue: "this" });
    expect(resolveAsharaYear("topic of majlis 1 this year", BEFORE)).toMatchObject({ year: "1448", cue: "this" });
    expect(resolveAsharaYear("what was today's waaz", BEFORE)).toMatchObject({ year: "1448", cue: "today" });
  });

  it("'last year' resolves to the most-recent completed Ashara (1447)", () => {
    expect(resolveAsharaYear("what was the topic of waaz last year", BEFORE)).toMatchObject({ year: "1447", cue: "last" });
  });

  it("no time cue → null (caller defaults to most-recent available)", () => {
    expect(resolveAsharaYear("topic of majlis 4", BEFORE)).toMatchObject({ year: null, cue: "none" });
  });

  it("activeStarted reflects whether Ashara 1448 has begun", () => {
    expect(resolveAsharaYear("today's waaz", BEFORE).activeStarted).toBe(false);
    expect(resolveAsharaYear("today's waaz", DURING).activeStarted).toBe(true);
  });
});

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

describe("isOverviewQuery", () => {
  it("detects list/overview/compare intent across majalis", () => {
    expect(isOverviewQuery("topics of all majalis in Ashara 1447")).toBe(true);
    expect(isOverviewQuery("give me an overview of every majlis")).toBe(true);
    expect(isOverviewQuery("list all the waaz themes")).toBe(true);
    expect(isOverviewQuery("compare majlis 4 and majlis 5")).toBe(true);
  });
  it("does not fire for a single-majlis question", () => {
    expect(isOverviewQuery("what was the theme of majlis 4")).toBe(false);
    expect(isOverviewQuery("jumla of majlis 2")).toBe(false);
  });
});

describe("isDeepQuery", () => {
  it("detects explicit go-deeper intent", () => {
    expect(isDeepQuery("tell me more about majlis 4")).toBe(true);
    expect(isDeepQuery("any stories from majlis 1")).toBe(true);
    expect(isDeepQuery("explain majlis 3 in detail")).toBe(true);
  });
  it("stays false for a plain theme question", () => {
    expect(isDeepQuery("what was the theme of majlis 4")).toBe(false);
  });
});
