import { describe, expect, it } from "vitest";

import {
  extractYouTubeId,
  youtubeEmbedUrl,
  youtubeThumbnailUrl,
} from "@/lib/webinars/youtube";

describe("webinars youtube helpers", () => {
  it("extracts the video ID from watch, youtu.be and embed URLs", () => {
    expect(extractYouTubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ",
    );
    expect(extractYouTubeId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(extractYouTubeId("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ",
    );
    expect(
      extractYouTubeId("https://www.youtube.com/watch?list=abc&v=dQw4w9WgXcQ"),
    ).toBe("dQw4w9WgXcQ");
  });

  it("returns null when no video ID is present", () => {
    expect(extractYouTubeId("https://example.com/not-a-video")).toBeNull();
    expect(extractYouTubeId("")).toBeNull();
  });

  it("builds thumbnail and embed URLs from a video ID", () => {
    expect(youtubeThumbnailUrl("dQw4w9WgXcQ")).toBe(
      "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    );
    expect(youtubeEmbedUrl("dQw4w9WgXcQ")).toContain(
      "https://www.youtube.com/embed/dQw4w9WgXcQ?",
    );
    expect(youtubeEmbedUrl("dQw4w9WgXcQ")).toContain("autoplay=1");
  });
});
