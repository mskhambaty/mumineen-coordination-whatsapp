import { describe, expect, it } from "vitest";

import {
  RELIGIOUS_TOOL_NAMES,
  renderReligiousChatsHtml,
  type ExportConvo,
} from "@/lib/admin/religious-transcript";

const RANGE = { from: "2026-06-14", to: "2026-06-14", generatedAt: "2026-06-14T12:00:00.000Z" };

describe("RELIGIOUS_TOOL_NAMES", () => {
  it("covers the two religious tools", () => {
    expect([...RELIGIOUS_TOOL_NAMES]).toEqual(["answer_religious_questions", "get_lisan_word_meaning"]);
  });
});

describe("renderReligiousChatsHtml", () => {
  const convo: ExportConvo = {
    displayName: "Tester",
    phoneLast4: "4219",
    timeline: [
      { kind: "msg", direction: "inbound", body: "tell me about Majlis 7", at: "2026-06-14T05:00:00Z" },
      { kind: "tool", toolName: "answer_religious_questions", at: "2026-06-14T05:00:01Z" },
      { kind: "msg", direction: "outbound", body: "*Majlis 7 — Shams*…", at: "2026-06-14T05:00:02Z" },
    ],
  };

  it("renders a self-contained mobile HTML doc with the conversation", () => {
    const html = renderReligiousChatsHtml([convo], RANGE);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain('name="viewport"');
    expect(html).toContain("Tester");
    expect(html).toContain("…4219");
    expect(html).toContain("tell me about Majlis 7");
  });

  it("uses inbound (left) vs outbound (right) bubble sides", () => {
    const html = renderReligiousChatsHtml([convo], RANGE);
    expect(html).toContain('class="row in"');
    expect(html).toContain('class="row out"');
  });

  it("renders a tool-call chip naming the tool", () => {
    const html = renderReligiousChatsHtml([convo], RANGE);
    expect(html).toContain("answer_religious_questions");
    expect(html).toContain("Waaz / reflection");
    expect(html).toContain("⟢");
  });

  it("HTML-escapes user/bot bodies (no injection)", () => {
    const evil: ExportConvo = {
      displayName: 'A&B <script>',
      phoneLast4: "0000",
      timeline: [{ kind: "msg", direction: "inbound", body: '<b>hi</b> & "quote" \'x\'', at: "2026-06-14T05:00:00Z" }],
    };
    const html = renderReligiousChatsHtml([evil], RANGE);
    expect(html).not.toContain("<b>hi</b>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;b&gt;hi&lt;/b&gt;");
    expect(html).toContain("&amp;");
    expect(html).toContain("&quot;");
  });

  it("empty input → a friendly no-chats doc", () => {
    const html = renderReligiousChatsHtml([], RANGE);
    expect(html).toContain("No religious / Lisan chats");
    expect(html).not.toContain('class="row');
  });
});
