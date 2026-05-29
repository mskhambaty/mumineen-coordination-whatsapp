import { describe, expect, it, vi } from "vitest";

import { parseTranscript } from "@/lib/transcripts/parser";

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
                      confidence: 0.3,
                    },
                  ],
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
    expect(result.events).toHaveLength(2); // Only events with confidence >= 0.5
    expect(result.events[0].event_type).toBe("task_created");
    expect(result.events[0].sender_alias).toBe("Moiz Broachwala");
    expect(result.events[0].confidence).toBeGreaterThanOrEqual(0.5);
  });

  it("filters out low confidence events", async () => {
    const result = await parseTranscript("any content");
    // The mock returns 3 events, but one has confidence 0.3 so it gets filtered
    expect(result.events.every((e) => e.confidence >= 0.5)).toBe(true);
  });
});
