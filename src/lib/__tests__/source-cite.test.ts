import { describe, expect, it } from "vitest";

import {
  collectSources,
  ensureSourcesCited,
  newSourceCollector,
  looksLeakedOrGarbled,
  sanitizeFinalReply,
} from "@/lib/agent/run-agent";

const URL2 = "https://blogs.jameasaifiyah.edu/reflection/ashara/1447h/reflections-majlis-2-5/";
const URL7 = "https://blogs.jameasaifiyah.edu/reflection/ashara/1447h/reflections-majlis-7-6/";

describe("collectSources", () => {
  it("extracts the title + url from a religious tool result", () => {
    const c = newSourceCollector();
    collectSources(c, "answer_religious_questions", {
      status: "ok",
      context: `[Reflections — Ashara 1447H, Majlis 7 (8th Muharram) — Source: ${URL7}]\nThe Shams (Sun)…`,
    });
    expect(c.religious).toEqual([{ title: "Reflections — Ashara 1447H, Majlis 7 (8th Muharram)", url: URL7 }]);
  });

  it("collects multiple distinct sources", () => {
    const c = newSourceCollector();
    collectSources(c, "answer_religious_questions", {
      status: "ok",
      context: `[A — Source: ${URL2}]\nx\n\n---\n\n[B — Source: ${URL7}]\ny`,
    });
    expect(c.religious.map((s) => s.url)).toEqual([URL2, URL7]);
  });

  it("marks a successful Lisan lookup for dictionary citation", () => {
    const c = newSourceCollector();
    collectSources(c, "get_lisan_word_meaning", { status: "ok", matches: [{ meaning: "Water" }] });
    expect(c.lisanDictionary).toBe(true);
  });

  it("collects nothing for no-match / not-found results", () => {
    const c = newSourceCollector();
    collectSources(c, "answer_religious_questions", { status: "no_indexed_match", message: "…" });
    collectSources(c, "get_lisan_word_meaning", { status: "not_found" });
    expect(c.religious).toHaveLength(0);
    expect(c.lisanDictionary).toBe(false);
  });
});

describe("ensureSourcesCited", () => {
  it("appends the source line when the model omitted it", () => {
    const c = newSourceCollector();
    c.religious.push({ title: "Reflections — Majlis 7", url: URL7 });
    const out = ensureSourcesCited("Majlis 7 was about the Sun.", c);
    expect(out).toBe(`Majlis 7 was about the Sun.\n\nSource: Reflections — Majlis 7 — ${URL7}`);
  });

  it("does not double-cite when the link is already in the reply", () => {
    const c = newSourceCollector();
    c.religious.push({ title: "Reflections — Majlis 7", url: URL7 });
    const reply = `Majlis 7 was about the Sun. Source: Reflections — Majlis 7 — ${URL7}`;
    expect(ensureSourcesCited(reply, c)).toBe(reply);
  });

  it("appends the dictionary source for word lookups", () => {
    const c = newSourceCollector();
    c.lisanDictionary = true;
    expect(ensureSourcesCited("Aab means Water.", c)).toBe("Aab means Water.\n\nSource: Lisan ud Dawat dictionary");
    // …but not if already present
    expect(ensureSourcesCited("Aab means Water. (Lisan ud Dawat dictionary)", c)).toBe(
      "Aab means Water. (Lisan ud Dawat dictionary)",
    );
  });

  it("leaves replies untouched when there are no sources", () => {
    expect(ensureSourcesCited("Which hotels have a shuttle?", newSourceCollector())).toBe("Which hotels have a shuttle?");
  });
});

describe("sanitizeFinalReply (high-model garbage safety net)", () => {
  const FALLBACK = "I am sorry, I could not produce a reliable answer just now. Please check official Anjuman announcements or try again shortly.";

  it("detects leaked tool-call syntax and CJK garbage", () => {
    expect(looksLeakedOrGarbled('to=functions.move_to_escalation {"category":"religious_followup"}')).toBe(true);
    expect(looksLeakedOrGarbled("天天中彩票这个")).toBe(true);
    expect(looksLeakedOrGarbled("Majlis 7 was about the Sun (Shams).")).toBe(false);
  });

  it("replaces a wholly-leaked reply with the safe fallback (the real screenshot bug)", () => {
    const leaked =
      'to=functions.move_to_escalation 天天中彩票这个уҷson {"category":"religious_followup","priority":"normal","reason":"User is asking whether fasting on Ashura is required."}';
    expect(sanitizeFinalReply(leaked)).toBe(FALLBACK);
  });

  it("passes a clean reply through unchanged", () => {
    const clean = "*Majlis 7 — Shams (the Sun)*: connection with Wali Allah and the radiance of guidance.";
    expect(sanitizeFinalReply(clean)).toBe(clean);
  });

  it("strips a stray garbage token but keeps a substantive answer", () => {
    const dirty = "Majlis 7 was about the Sun (Shams), a motif for the radiance of divine guidance in the waaz. 天天";
    const out = sanitizeFinalReply(dirty);
    expect(out).not.toMatch(/[一-鿿]/);
    expect(out).toContain("Shams");
  });
});
