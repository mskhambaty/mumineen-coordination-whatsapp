import { describe, expect, it } from "vitest";

import {
  NOT_FOUND_REPLY,
  THIS_YEAR_OFFER_LAST,
  maybeSingleWordQuery,
  renderLisanReply,
  isClearlySocial,
  hasReligiousSignal,
  isAffirmative,
  isDidYouMeanFollowUp,
  pickDidYouMeanCandidate,
  parseOrdinalPick,
  extractHijriYears,
  yearLabelMismatch,
} from "@/lib/agent/religious-guard";

describe("maybeSingleWordQuery", () => {
  it("detects explicit word-meaning asks (force answer)", () => {
    expect(maybeSingleWordQuery("What does takht mean?")).toEqual({ word: "takht", forceAnswer: true });
    expect(maybeSingleWordQuery("meaning of farzand")).toEqual({ word: "farzand", forceAnswer: true });
    expect(maybeSingleWordQuery("rai ni su maana che")).toEqual({ word: "rai", forceAnswer: true });
    expect(maybeSingleWordQuery("chawal ni maana")).toEqual({ word: "chawal", forceAnswer: true });
  });

  it("treats an Arabic-script bare token as a forced word lookup", () => {
    const r = maybeSingleWordQuery("تخت");
    expect(r?.forceAnswer).toBe(true);
    expect(r?.word).toBe("تخت");
  });

  it("treats a Latin bare token as a non-forced lookup (falls through on a dict miss)", () => {
    expect(maybeSingleWordQuery("farzand")).toEqual({ word: "farzand", forceAnswer: false });
    expect(maybeSingleWordQuery("Tekri")).toEqual({ word: "Tekri", forceAnswer: false });
  });

  it("does NOT fire for multi-word / non-lookup messages", () => {
    expect(maybeSingleWordQuery("Who is the 53rd dai?")).toBeNull();
    expect(maybeSingleWordQuery("what was the theme of majlis 3")).toBeNull();
    expect(maybeSingleWordQuery("which hotel has a shuttle")).toBeNull();
  });
});

describe("renderLisanReply", () => {
  it("ok → word + meaning + dictionary source", () => {
    const out = renderLisanReply({ status: "ok", matches: [{ transliteration: "Aab", lisan: "آب", meaning: "Water", example: null }] });
    expect(out).toContain("*Aab*");
    expect(out).toContain("Water");
    expect(out).toContain("Source: Lisan ud Dawat dictionary");
  });
  it("did_you_mean → numbered list, no source", () => {
    const out = renderLisanReply({ status: "did_you_mean", suggestions: [
      { transliteration: "Aar", lisan: "اار", meaning: "x", example: null },
      { transliteration: "Aari", lisan: "ااري", meaning: "y", example: null },
    ] });
    expect(out).toContain("1. *Aar*");
    expect(out).toContain("2. *Aari*");
    expect(out).toContain("Reply with the number");
    expect(out).not.toContain("Source:");
  });
  it("not_found → no source line", () => {
    expect(renderLisanReply({ status: "not_found" })).not.toContain("Source:");
  });
});

describe("isClearlySocial", () => {
  it("passes greetings / thanks / dua / chant / bare ack", () => {
    for (const m of ["Salaam", "Salaam un Jameel", "shukran", "thank you", "Aameen", "Mola Mola Mufaddal Mola", "Ya Ali Madad", "ok", "👍", "dua ma yaad rakhjo"]) {
      expect(isClearlySocial(m), m).toBe(true);
    }
  });
  it("does NOT treat substantive questions as social", () => {
    for (const m of ["Who is the 53rd dai?", "what was the theme of majlis 3", "is dragon fruit halal"]) {
      expect(isClearlySocial(m), m).toBe(false);
    }
  });
});

describe("hasReligiousSignal", () => {
  it("catches deen questions (incl. the 53rd-dai / nas cases)", () => {
    for (const m of ["Who is the 53rd dai?", "when did the nas happen", "tell me about majlis 7", "what did Maula say", "reflection on karbala"]) {
      expect(hasReligiousSignal(m), m).toBe(true);
    }
  });
  it("leaves logistics / generic messages alone", () => {
    for (const m of ["which hotel has a shuttle", "where is parking", "what time is registration"]) {
      expect(hasReligiousSignal(m), m).toBe(false);
    }
  });
});

describe("isAffirmative", () => {
  it("accepts short yes-style replies", () => {
    for (const m of ["yes", "yes please", "haan", "sure", "ok", "show me"]) expect(isAffirmative(m), m).toBe(true);
  });
  it("rejects non-affirmatives and long messages", () => {
    expect(isAffirmative("no thanks")).toBe(false);
    expect(isAffirmative("what was it about")).toBe(false);
    expect(isAffirmative("yes but only if it is about the reflection of majlis three please")).toBe(false);
  });
});

describe("did-you-mean numeric follow-up parsing", () => {
  const prev = "I don't have that exact word.\n1. *Aar* (_اار_)\n2. *Aari* (_ااري_)\n3. *Eiri* (_ايري_)\nReply with the number for its meaning.";
  it("recognises a numeric/ordinal pick only after a did-you-mean list", () => {
    expect(isDidYouMeanFollowUp("2", prev)).toBe(true);
    expect(isDidYouMeanFollowUp("the second one", prev)).toBe(true);
    expect(isDidYouMeanFollowUp("2", "some unrelated message")).toBe(false);
  });
  it("maps the pick to the right candidate word", () => {
    expect(pickDidYouMeanCandidate("2", prev)).toBe("Aari");
    expect(pickDidYouMeanCandidate("first", prev)).toBe("Aar");
    expect(parseOrdinalPick("3")).toBe(3);
  });
});

describe("Hijri-year extraction + post-check", () => {
  it("extracts stated Hijri years", () => {
    expect(extractHijriYears("In *Ashara 1447H*, Majlis 4 …")).toEqual(["1447"]);
    expect(extractHijriYears("no year mentioned here")).toEqual([]);
  });
  it("flags a year that conflicts with the source row's year", () => {
    expect(yearLabelMismatch("In Ashara 1448H …", "1447")).toBe(true); // wrong year stated
    expect(yearLabelMismatch("In Ashara 1447H …", "1447")).toBe(false); // matches
    expect(yearLabelMismatch("In Ashara 1447H …", null)).toBe(true); // null-year block must state none
    expect(yearLabelMismatch("no year here", null)).toBe(false);
  });
});

describe("fixed reply constants", () => {
  it("contain no Source line and read as intended", () => {
    expect(NOT_FOUND_REPLY).toContain("published Ashara Mubaraka reflections");
    expect(NOT_FOUND_REPLY).not.toContain("Source:");
    expect(THIS_YEAR_OFFER_LAST).toContain("1448H");
    expect(THIS_YEAR_OFFER_LAST).toContain("1447H");
    expect(THIS_YEAR_OFFER_LAST).not.toContain("Source:");
  });
});
