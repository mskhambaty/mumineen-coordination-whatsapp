import { describe, expect, it } from "vitest";

import {
  FIXED_MEETING_PROMPT,
  FIXED_TRANSCRIPT_PROMPT,
  getDefaultFlexiblePrompt,
} from "@/lib/transcripts/prompts";

describe("transcript prompts", () => {
  it("includes coordination extraction rules in locked prompts", () => {
    expect(FIXED_TRANSCRIPT_PROMPT).toContain("Coordination Language Rules");
    expect(FIXED_TRANSCRIPT_PROMPT).toContain("can you");
    expect(FIXED_TRANSCRIPT_PROMPT).toContain("new_members");
    expect(FIXED_MEETING_PROMPT).toContain("Meeting-Specific Rules");
    expect(FIXED_MEETING_PROMPT).toContain("Coordination Language Rules");
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
    expect(meetingPrompt).toContain("agenda decisions");
    expect(whatsappPrompt).toContain("IT/ITS");
    expect(meetingPrompt).toContain("IT/ITS");
  });
});
