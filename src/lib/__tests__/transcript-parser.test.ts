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
