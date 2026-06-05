import { describe, expect, it, vi } from "vitest";

import { parseTranscript, parseTranscriptHeuristically } from "@/lib/transcripts/parser";

// Mock OpenAI
vi.mock("openai", () => {
  return {
    default: class MockOpenAI {
      chat = {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{
              message: {
                content: JSON.stringify({
                  group_name: "Test Group",
                  last_message_at: "2026-05-29T12:00:00Z",
                  events: [
                    {
                      event_type: "task_created",
                      sender_alias: "Moiz Broachwala",
                      message_timestamp: "2026-05-29T10:00:00Z",
                      message_text: "We need to finish the venue setup by Friday",
                      ai_summary: "Task to complete venue setup by Friday",
                      task_title: "Complete venue setup",
                      assigned_to_alias: null,
                      priority: "medium",
                      confidence: 0.85,
                    },
                    {
                      event_type: "info",
                      sender_alias: "Hussain Koita",
                      message_timestamp: "2026-05-29T11:00:00Z",
                      message_text: "The contractor will arrive at 9am",
                      ai_summary: "Contractor arriving at 9am",
                      task_title: null,
                      assigned_to_alias: null,
                      priority: "medium",
                      confidence: 0.6,
                    },
                    {
                      event_type: "task_created",
                      sender_alias: "Test User",
                      message_timestamp: "2026-05-29T11:30:00Z",
                      message_text: "Low confidence item",
                      ai_summary: "Something uncertain",
                      task_title: "Uncertain task",
                      assigned_to_alias: null,
                      priority: "low",
                      confidence: 0.3,
                    },
                  ],
                  new_members: [{ alias: "New Volunteer", context: "New Volunteer can help with setup" }],
                }),
              },
            }],
          }),
        },
      };
    },
  };
});

// Mock env
vi.mock("@/lib/env", () => ({
  requireEnv: (key: string) => {
    if (key === "OPENAI_API_KEY") return "test-key";
    return "";
  },
  optionalEnv: () => "gpt-4.1-mini",
}));

describe("parseTranscript", () => {
  it("parses transcript and returns structured events", async () => {
    const rawContent = `5/29/26, 10:00 AM - Moiz Broachwala: We need to finish the venue setup by Friday
5/29/26, 11:00 AM - Hussain Koita: The contractor will arrive at 9am`;

    const result = await parseTranscript(rawContent);

    expect(result.group_name).toBe("Test Group");
    expect(result.last_message_at).toBe("2026-05-29T12:00:00Z");
    expect(result.events.length).toBeGreaterThanOrEqual(2);
    expect(result.events[0].event_type).toBe("task_created");
    expect(result.events[0].sender_alias).toBe("Moiz Broachwala");
    expect(result.events[0].priority).toBe("medium");
    expect(result.new_members).toHaveLength(1);
  });

  it("extracts proposals from bracketed WhatsApp exports when AI returns no usable events", () => {
    const result = parseTranscriptHeuristically(`[5/29/26, 10:17:37 AM] Huzaifa Tapal.Chicago: @⁨Mansoor Anjarwala.Chicago⁩ I think we should setup a FAQ page with common questions and answers to them.
[5/29/26, 10:20:41 AM] Mansoor Anjarwala.Chicago: Raja, can you take this and create a faq doc?
[5/29/26, 12:13:37 PM] Yusuf Bhaisaheb S Vajihuddin.Chicago: Mansoor Anjarwala.Chicago added Yusuf Bhaisaheb S Vajihuddin.Chicago
[5/29/26, 12:17:49 PM] Shabbir Karimi.chicago: need to disable the website from the public from now. If you can find a way to make it password protected so our people can see it for private review, but it can't be public.`);

    expect(result.last_message_at).toBe("2026-05-29T12:17:49.000Z");
    expect(result.events.length).toBeGreaterThanOrEqual(3);
    expect(result.events.some((event) => event.item_type === "issue")).toBe(true);
    expect(result.new_members).toEqual([
      {
        alias: "Yusuf Bhaisaheb S Vajihuddin.Chicago",
        context: "Yusuf Bhaisaheb S Vajihuddin.Chicago added Yusuf Bhaisaheb S Vajihuddin.Chicago",
      },
    ]);
  });
});

describe("JSONL format support", () => {
  const { isJsonlFormat, convertJsonlToWhatsAppText } = require("@/lib/transcripts/parser");

  const sampleJsonl = [
    '{"group_jid":"120363428427686503@g.us","sender_name":"Murtaza Ali Hussain","body":"Is this someone testing?","ts":1780639521000,"wa_msg_id":"3BE7FF3C"}',
    '{"group_jid":"120363428427686503@g.us","sender_name":"Aliasgar Umaini","body":"Yes, a few my friends are testing it","ts":1780639889000,"wa_msg_id":"3BD9737B"}',
    '{"group_jid":"120363428427686503@g.us","sender_name":"Mustafa Hussain","body":"This is too good","ts":1780639904000,"wa_msg_id":"AC7C51B7"}',
  ].join("\n");

  it("detects JSONL format", () => {
    expect(isJsonlFormat(sampleJsonl)).toBe(true);
    expect(isJsonlFormat("[6/2/26, 10:00:00 AM] Sender: hello")).toBe(false);
    expect(isJsonlFormat("")).toBe(false);
  });

  it("converts JSONL to WhatsApp text format", () => {
    const result = convertJsonlToWhatsAppText(sampleJsonl);
    const lines = result.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^\[\d+\/\d+\/\d+, \d+:\d+:\d+ [AP]M\] Murtaza Ali Hussain: Is this someone testing\?$/);
    expect(lines[1]).toMatch(/^\[\d+\/\d+\/\d+, \d+:\d+:\d+ [AP]M\] Aliasgar Umaini: Yes, a few my friends are testing it$/);
  });

  it("applies cutoff timestamp filter", () => {
    // Cutoff after first message (ts=1780639521000 → 2026-06-04T...)
    const cutoffDate = new Date(1780639521000);
    const result = convertJsonlToWhatsAppText(sampleJsonl, cutoffDate.toISOString());
    const lines = result.split("\n").filter(Boolean);
    // First message ts === cutoff should be excluded (<=), only messages after cutoff remain
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("Aliasgar Umaini");
  });

  it("skips invalid JSON lines", () => {
    const content = 'not json\n{"sender_name":"Test","body":"hello","ts":1780639521000}\n{bad';
    const result = convertJsonlToWhatsAppText(content);
    const lines = result.split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Test: hello");
  });

  it("heuristic parser works on converted JSONL output", () => {
    const converted = convertJsonlToWhatsAppText(sampleJsonl);
    const result = parseTranscriptHeuristically(converted);
    expect(result.last_message_at).not.toBeNull();
  });
});
