import { describe, expect, it } from "vitest";

import {
  NOT_FOUND_REPLY,
  THIS_YEAR_OFFER_LAST,
  ISTIBSAAR_ONCALL_URL,
  appendOnCallSuggestion,
  maybeReverseWordQuery,
  maybeSingleWordQuery,
  renderLisanReply,
  renderReverseLisanReply,
  isClearlySocial,
  hasReligiousSignal,
  looksLikeFactualLookup,
  looksLikeReligiousQuestion,
  looksLikeOwnRsvpIntent,
  isAffirmative,
  isDidYouMeanFollowUp,
  pickDidYouMeanCandidate,
  parseOrdinalPick,
  extractHijriYears,
  yearLabelMismatch,
} from "@/lib/agent/religious-guard";

describe("looksLikeFactualLookup", () => {
  it("matches who/what-was factual person/term lookups (must answer from reflections only)", () => {
    for (const q of [
      "Who was Abu sufyan",
      "who is Abu Sufyan?",
      "What was imam Mansoor known for and what Maula mention yesterday",
      "tell me about al-Mahdiyya",
      "what is sehr-e-halal",
    ]) {
      expect(looksLikeFactualLookup(q), q).toBe(true);
    }
  });

  it("does NOT match self/meta or logistics-shaped phrasings", () => {
    for (const q of [
      "who are you",
      "what is this",
      "what is this number",
      "what is my rsvp",
      "what time is the waaz",
      "where is parking",
      "can I bring a wheelchair",
    ]) {
      expect(looksLikeFactualLookup(q), q).toBe(false);
    }
  });
});

describe("looksLikeReligiousQuestion (force the search for how/why-did religious questions)", () => {
  it("matches interrogative questions about a religious subject — incl. the exact flickering cases", () => {
    for (const q of [
      // The two queries that answered once then returned "not found" the next time (tool not forced):
      "How did Imam Hasan AS reunite the very couple Muʿawiya had schemed to tear apart?",
      "Why did Amirul Mumineen AS (Maulana Ali AS) stop in the middle of the Battle of Siffin?",
      'What happened when a man gave only "Allah" as his guarantor for a camel?',
      "what did Syedna TUS say about business",
      "explain the topic of majlis 8",
      "tell me about karbala",
    ]) {
      expect(looksLikeReligiousQuestion(q), q).toBe(true);
    }
  });

  it("requires BOTH an interrogative AND a religious subject (keyword or honorific)", () => {
    // Honorific 'AS' is matched case-sensitively, so the English word "as" must not trigger it.
    expect(looksLikeReligiousQuestion("how was your day as a teacher")).toBe(false); // no signal, "as" != AS
    expect(looksLikeReligiousQuestion("Imam Husain AS")).toBe(false); // religious, but not a question
    expect(looksLikeReligiousQuestion("how do I get my pass")).toBe(false); // interrogative, not religious
    expect(looksLikeReligiousQuestion("where is parking")).toBe(false); // interrogative, not religious
    // Known limitation: a religious question with NO keyword and NO honorific (e.g. "how did an
    // ironsmith hold scorching iron") can't be detected lexically, so it stays on tool_choice "auto".
    // Forcing on EVERY interrogative would risk hijacking mis-detected logistics/RSVP questions.
    expect(looksLikeReligiousQuestion("How did an ironsmith come to hold scorching iron")).toBe(false);
  });
});

describe("looksLikeOwnRsvpIntent", () => {
  it("matches possessive RSVP/attendance questions even when they name a Moharram day", () => {
    expect(looksLikeOwnRsvpIntent("What is my RSVP for 4th moharram")).toBe(true);
    expect(looksLikeOwnRsvpIntent("did we sign up for ashura")).toBe(true);
    expect(looksLikeOwnRsvpIntent("are we attending pehli raat")).toBe(true);
    expect(looksLikeOwnRsvpIntent("change my rsvp")).toBe(true);
    expect(looksLikeOwnRsvpIntent("what did i rsvp")).toBe(true);
  });

  it("does NOT match religious content questions about a majlis", () => {
    expect(looksLikeOwnRsvpIntent("what was said in the 4th moharram waaz")).toBe(false);
    expect(looksLikeOwnRsvpIntent("main message of majlis 2")).toBe(false);
    expect(looksLikeOwnRsvpIntent("five qualities of IT professionals")).toBe(false);
    expect(looksLikeOwnRsvpIntent("")).toBe(false);
  });
});

describe("appendOnCallSuggestion", () => {
  const inbound = (n: number) => Array.from({ length: n }, () => ({ direction: "inbound", body: "q" }));

  it("force=true always appends (a can't-answer dead-end)", () => {
    const out = appendOnCallSuggestion("nope", [{ direction: "inbound", body: "q" }], { force: true });
    expect(out).toContain("nope");
    expect(out).toContain(ISTIBSAAR_ONCALL_URL);
  });

  it("force=false appends only after >= 3 inbound messages", () => {
    expect(appendOnCallSuggestion("ans", inbound(2), { force: false })).toBe("ans");
    expect(appendOnCallSuggestion("ans", inbound(3), { force: false })).toContain(ISTIBSAAR_ONCALL_URL);
  });

  it("dedupes: skips if a recent outbound already suggested it", () => {
    const history = [...inbound(5), { direction: "outbound", body: `Earlier reply… ${ISTIBSAAR_ONCALL_URL}` }];
    expect(appendOnCallSuggestion("ans", history, { force: true })).toBe("ans");
  });
});

describe("maybeSingleWordQuery", () => {
  it("detects explicit word-meaning asks (force answer)", () => {
    expect(maybeSingleWordQuery("What does takht mean?")).toEqual({ word: "takht", forceAnswer: true });
    expect(maybeSingleWordQuery("meaning of farzand")).toEqual({ word: "farzand", forceAnswer: true });
    expect(maybeSingleWordQuery("what is the meaning of shadi")).toEqual({ word: "shadi", forceAnswer: true });
    expect(maybeSingleWordQuery("shadi meaning")).toEqual({ word: "shadi", forceAnswer: true });
    expect(maybeSingleWordQuery("aflaak means?")).toEqual({ word: "aflaak", forceAnswer: true });
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
  it("catches core figures/terms that were missing (allah, rasul, nabi, sahaba, ghulam, sadaqa)", () => {
    for (const m of [
      // The exact eval miss: a fabricated camel-guarantor answer with a fake Majlis 8 source.
      'What happened when a man gave only "Allah" as his guarantor for a camel?',
      "what did Rasul Allah SAW say",
      "tell me about the ghulam of Bani Riyah",
      "what is the reward of sadaqa",
    ]) {
      expect(hasReligiousSignal(m), m).toBe(true);
    }
  });
  it("does NOT fire on inshallah / mashallah / alhamdolillah (no word boundary before 'allah')", () => {
    for (const m of ["inshallah I will come", "mashallah great nizam", "alhamdolillah done"]) {
      expect(hasReligiousSignal(m), m).toBe(false);
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

describe("maybeReverseWordQuery (English → Lisan intent)", () => {
  it("detects 'lisan word for X' phrasings and extracts the English term", () => {
    expect(maybeReverseWordQuery("what is the lisan word for brain")).toEqual({ english: "brain" });
    expect(maybeReverseWordQuery("Lisan ud Dawat word for patience")).toEqual({ english: "patience" });
    expect(maybeReverseWordQuery("lisan word of the heart")).toEqual({ english: "heart" }); // leading article stripped
  });

  it("detects 'X in lisan ud dawat' phrasings", () => {
    expect(maybeReverseWordQuery("what is sun in lisan ud dawat")).toEqual({ english: "sun" });
    expect(maybeReverseWordQuery("Brain in Lisan ud dawat")).toEqual({ english: "brain" });
    expect(maybeReverseWordQuery("how do you say patience in lisan")).toEqual({ english: "patience" });
  });

  it("does NOT match forward 'what does X mean' asks (those stay forward lookups)", () => {
    expect(maybeReverseWordQuery("what does kamar mean")).toBeNull();
    expect(maybeReverseWordQuery("kamar")).toBeNull();
    expect(maybeReverseWordQuery("meaning of jafakash")).toBeNull();
    expect(maybeReverseWordQuery("what is the meaning of aaeen")).toBeNull();
  });
});

describe("renderReverseLisanReply", () => {
  it("ok: heads with the English term and lists the Lisan word + meaning + dictionary source", () => {
    const out = renderReverseLisanReply("hardworking", {
      status: "ok",
      matches: [{ transliteration: "Jafakash", lisan: "جفاكش", meaning: "Painstaking, hardworking", example: null }],
    });
    expect(out).toContain("*hardworking*");
    expect(out).toContain("*Jafakash*");
    expect(out).toContain("Source: Lisan ud Dawat dictionary");
  });

  it("not_found: a clean message, no source line, no forward fuzzy guess", () => {
    const out = renderReverseLisanReply("brain", { status: "not_found" });
    expect(out).toContain("don't have a Lisan ud Dawat word for *brain*");
    expect(out).not.toContain("Source:");
  });
});
