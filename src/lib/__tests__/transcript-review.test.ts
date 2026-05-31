import { describe, expect, it } from "vitest";

import {
  buildEventReview,
  filterUnknownNewMembers,
  type ExistingTranscriptItems,
} from "@/lib/transcripts/review";

const existingItems: ExistingTranscriptItems = {
  milestones: [
    { id: "milestone-1", title: "Venue setup complete", status: "in_progress", percent_complete: 40, budget: null },
  ],
  tasks: [
    { id: "task-1", title: "Confirm AV vendor", status: "open", item_type: "task" },
    { id: "issue-1", title: "Parking permit blocked", status: "blocked", item_type: "issue" },
  ],
};

describe("transcript review helpers", () => {
  it("matches update events to existing tasks", () => {
    const review = buildEventReview({
      event_type: "task_completed",
      item_type: "task",
      task_title: "AV vendor confirmed",
      milestone_title: null,
      ai_summary: "Confirm AV vendor is done",
      message_text: null,
    }, existingItems);

    expect(review.review_action).toBe("update");
    expect(review.review_kind).toBe("task");
    expect(review.target_id).toBe("task-1");
  });

  it("keeps genuinely new milestone events as creates", () => {
    const review = buildEventReview({
      event_type: "milestone_created",
      item_type: "milestone",
      milestone_title: "Volunteer roster finalized",
      task_title: null,
      ai_summary: null,
      message_text: null,
    }, existingItems);

    expect(review.review_action).toBe("create");
    expect(review.review_kind).toBe("milestone");
    expect(review.target_id).toBeNull();
  });

  it("filters parsed members that already exist by display name or alias", () => {
    const members = filterUnknownNewMembers(
      [
        { alias: "Mufaddal", context: "sent a message" },
        { alias: "New Volunteer", context: "offered to help" },
      ],
      [
        { display_name: "Mufaddal Khambaty", transcript_aliases: ["Mufaddal"] },
      ],
    );

    expect(members).toEqual([{ alias: "New Volunteer", context: "offered to help" }]);
  });
});
