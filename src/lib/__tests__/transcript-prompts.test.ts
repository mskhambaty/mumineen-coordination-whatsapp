import { describe, expect, it } from "vitest";

import {
  FIXED_MEETING_PROMPT,
  FIXED_TRANSCRIPT_PROMPT,
  getDefaultFlexiblePrompt,
} from "@/lib/transcripts/prompts";

describe("transcript prompts", () => {
  it("includes coordination extraction rules in locked prompts", () => {
    expect(FIXED_TRANSCRIPT_PROMPT).toContain("extract_project_events");
    expect(FIXED_TRANSCRIPT_PROMPT).toContain("assigned_to_alias");
    expect(FIXED_TRANSCRIPT_PROMPT).toContain("Do not output member creation suggestions");
    expect(FIXED_MEETING_PROMPT).toContain("meeting transcript");
    expect(FIXED_MEETING_PROMPT).toContain("extract_project_events");
  });

  it("returns Site/Construction-specific rules without matching IT", () => {
    const prompt = getDefaultFlexiblePrompt("Site/Construction", "whatsapp");

    expect(prompt).toContain("Site/Construction");
    expect(prompt).toContain("HVAC");
    expect(prompt).not.toContain("login/database bugs");
  });

  it("returns different transcript-mode defaults", () => {
    const whatsappPrompt = getDefaultFlexiblePrompt("IT", "whatsapp");
    const meetingPrompt = getDefaultFlexiblePrompt("IT", "meeting");

    expect(whatsappPrompt).toContain("mentions, direct replies");
    expect(meetingPrompt).toContain("follow-ups without owners");
    expect(whatsappPrompt).toContain("IT/ITS");
    expect(meetingPrompt).toContain("IT/ITS");
  });
});
