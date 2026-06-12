// Pure helpers for deriving YouTube identifiers and assets from a video URL.
// Used by the public webinars grid to render thumbnails and embeds.

const YOUTUBE_ID_RE =
  /(?:youtube\.com\/watch\?(?:.*&)?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/;

/** Extracts the 11-char video ID from a watch / youtu.be / embed URL, or null. */
export function extractYouTubeId(url: string): string | null {
  const m = url.match(YOUTUBE_ID_RE);
  return m ? m[1] : null;
}

/**
 * Thumbnail URL for a video ID. `hqdefault` (480×360) always exists for public
 * and unlisted videos; render it with `object-cover` on a 16:9 box to crop the
 * letterbox bars.
 */
export function youtubeThumbnailUrl(videoId: string): string {
  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
}

/** Embed URL configured for the modal player (autoplay, minimal chrome). */
export function youtubeEmbedUrl(videoId: string): string {
  return `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1&playsinline=1`;
}
