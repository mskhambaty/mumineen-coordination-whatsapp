import { describe, expect, it } from "vitest";

import {
  collectSources,
  finalizeSources,
  distinctSourceGroups,
  looksLikeHandoff,
  newSourceCollector,
  looksLeakedOrGarbled,
  sanitizeFinalReply,
} from "@/lib/agent/run-agent";

const URL2 = "https://blogs.jameasaifiyah.edu/reflection/ashara/1447h/reflections-majlis-2-5/";
const URL7 = "https://blogs.jameasaifiyah.edu/reflection/ashara/1447h/reflections-majlis-7-6/";
const ARCHIVE = "https://blogs.jameasaifiyah.edu/reflection-category/1447h/";
const ANSWER = { decision: "answer" as string | null, year: "1447" as string | null, archiveUrl: null as string | null };

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

describe("distinctSourceGroups (collapse by majlis, not by url)", () => {
  it("counts two facets of the SAME majlis as one article", () => {
    const c = newSourceCollector();
    c.religious.push({ title: "Reflections — Ashara 1447H, Majlis 6 (7th Muharram)", url: "u1" });
    c.religious.push({ title: "Al-Dars — Ashara 1447H, Majlis 6", url: "u2" });
    expect(distinctSourceGroups(c)).toBe(1);
  });
  it("counts different majalis distinctly", () => {
    const c = newSourceCollector();
    c.religious.push({ title: "Reflections — Ashara 1447H, Majlis 8 (9th Muharram)", url: "u8" });
    c.religious.push({ title: "Reflections — Ashara 1447H, Majlis 7 (8th Muharram)", url: "u7" });
    c.religious.push({ title: "Reflections — Ashara 1447H, Majlis 4 (5th Muharram)", url: "u4" });
    expect(distinctSourceGroups(c)).toBe(3);
  });
});

describe("looksLikeHandoff", () => {
  it("flags model-improvised hand-offs / refusals", () => {
    for (const r of [
      "To help with that properly, I need to pass it to the team for religious follow-up.",
      "I couldn't find this in the published reflections.",
      "I don't have that yet.",
    ]) expect(looksLikeHandoff(r), r).toBe(true);
  });
  it("does not flag a normal grounded answer", () => {
    expect(looksLikeHandoff("In Ashara 1447H, Majlis 7 was about the Sun (Shams).")).toBe(false);
  });
});

describe("finalizeSources", () => {
  it("appends the single precise source when the model omitted it", () => {
    const c = newSourceCollector();
    c.religious.push({ title: "Reflections — Ashara 1447H, Majlis 7", url: URL7 });
    const out = finalizeSources("Majlis 7 was about the Sun.", c, ANSWER);
    expect(out).toBe(`Majlis 7 was about the Sun.\n\nSource: Reflections — Ashara 1447H, Majlis 7 — ${URL7}`);
  });

  it("strips a model-emitted Source line and re-derives exactly one (no double-cite)", () => {
    const c = newSourceCollector();
    c.religious.push({ title: "Reflections — Ashara 1447H, Majlis 7", url: URL7 });
    const reply = `Majlis 7 was about the Sun.\n\nSource: Reflections — Ashara 1447H, Majlis 7 — ${URL7}`;
    const out = finalizeSources(reply, c, ANSWER);
    expect(out).toBe(reply);
    expect((out.match(/Source:/g) ?? []).length).toBe(1);
  });

  it("collapses a multi-majlis answer to ONE archive link (the 'shadi'/noise case)", () => {
    const c = newSourceCollector();
    for (const [m, u] of [["8", "u8"], ["7", "u7"], ["4", "u4"], ["6", "u6"]] as const) {
      c.religious.push({ title: `Reflections — Ashara 1447H, Majlis ${m}`, url: u });
    }
    const out = finalizeSources("In Ashara 1447H, marriage was discussed in Majlis 8.", c, { decision: "answer", year: "1447", archiveUrl: ARCHIVE });
    expect((out.match(/Source:/g) ?? []).length).toBe(1);
    expect(out).toContain(`Source: Ashara 1447H reflections — ${ARCHIVE}`);
    expect(out).not.toContain("u8");
  });

  it("two facets of one majlis keep the precise link (no collapse)", () => {
    const c = newSourceCollector();
    c.religious.push({ title: "Reflections — Ashara 1447H, Majlis 6", url: URL2 });
    c.religious.push({ title: "Al-Dars — Ashara 1447H, Majlis 6", url: URL7 });
    const out = finalizeSources("Majlis 6 covered Zohra.", c, { decision: "answer", year: "1447", archiveUrl: ARCHIVE });
    expect(out).toContain(`Source: Reflections — Ashara 1447H, Majlis 6 — ${URL2}`);
    expect(out).not.toContain(ARCHIVE);
  });

  it("falls back to the single best link when collapse is wanted but no archive URL resolved", () => {
    const c = newSourceCollector();
    c.religious.push({ title: "Reflections — Ashara 1447H, Majlis 8", url: "u8" });
    c.religious.push({ title: "Reflections — Ashara 1447H, Majlis 7", url: "u7" });
    const out = finalizeSources("…", c, { decision: "answer", year: "1447", archiveUrl: null });
    expect((out.match(/Source:/g) ?? []).length).toBe(1);
    expect(out).toContain("Majlis 8 — u8"); // first/best, never a stack
  });

  it("suppresses sources entirely on a hand-off reply even on the answer path", () => {
    const c = newSourceCollector();
    c.religious.push({ title: "Reflections — Ashara 1447H, Majlis 6", url: "u6" });
    c.religious.push({ title: "Reflections — Ashara 1447H, Majlis 7", url: "u7" });
    c.religious.push({ title: "Reflections — Ashara 1447H, Majlis 3", url: "u3" });
    const out = finalizeSources("To help with that properly, I need to pass it to the team for religious follow-up.", c, { decision: "answer", year: "1447", archiveUrl: ARCHIVE });
    expect(out).not.toContain("Source:");
  });

  it("suppresses sources when the decision is not an answer", () => {
    const c = newSourceCollector();
    c.religious.push({ title: "Reflections — Ashara 1447H, Majlis 6", url: "u6" });
    expect(finalizeSources("Some reply.", c, { decision: "not_found", year: "1447", archiveUrl: ARCHIVE })).not.toContain("Source:");
  });

  it("appends the dictionary source for a direct word lookup (decision null)", () => {
    const c = newSourceCollector();
    c.lisanDictionary = true;
    expect(finalizeSources("Aab means Water.", c, { decision: null, year: null, archiveUrl: null })).toBe(
      "Aab means Water.\n\nSource: Lisan ud Dawat dictionary",
    );
  });

  it("leaves replies untouched when there are no sources", () => {
    expect(finalizeSources("Which hotels have a shuttle?", newSourceCollector(), ANSWER)).toBe("Which hotels have a shuttle?");
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
