import { describe, expect, it } from "vitest";

import { collectSources, ensureSourcesCited, newSourceCollector } from "@/lib/agent/run-agent";

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
