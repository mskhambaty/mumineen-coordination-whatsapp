import { getSupabaseAdmin } from "@/lib/supabase/server";

// Feedback areas the daily flow collects, matching the daily_feedback_survey template
// ("Mawaid, Flow management, parking/transportation, Audio/video, etc."). Each area is
// owned by a department so the nightly per-department digest is a simple filter. The
// mapping is by department *name* (resolved to id at runtime) so it is environment
// independent — department UUIDs differ across projects.

export const FEEDBACK_AREAS = [
  "mawaid",
  "flow",
  "parking_transport",
  "audio_video",
  "accommodation",
  "seating",
  "general",
] as const;

export type FeedbackArea = (typeof FEEDBACK_AREAS)[number];

export function isFeedbackArea(value: unknown): value is FeedbackArea {
  return typeof value === "string" && (FEEDBACK_AREAS as readonly string[]).includes(value);
}

// Area → owning department name. "general" has no single owner (rolls up to the all-up
// leadership summary only), so it maps to null.
const AREA_DEPARTMENT_NAME: Record<FeedbackArea, string | null> = {
  mawaid: "Mawaid",
  flow: "Flow Management",
  parking_transport: "Transport",
  audio_video: "AVR",
  accommodation: "Accommodation",
  seating: "Rahat Support",
  general: null,
};

// Human label used in prompts / summaries.
export const AREA_LABEL: Record<FeedbackArea, string> = {
  mawaid: "Mawaid (jaman)",
  flow: "Flow management",
  parking_transport: "Parking & transportation",
  audio_video: "Audio / video",
  accommodation: "Accommodation",
  seating: "Seating / rahat",
  general: "General",
};

// Cache department-name → id for the lifetime of the server process; the department
// list is small and effectively static during an event.
let deptIdByNameCache: Map<string, string> | null = null;

async function loadDepartmentIdByName(): Promise<Map<string, string>> {
  if (deptIdByNameCache) return deptIdByNameCache;
  const { data } = await getSupabaseAdmin().from("departments").select("id, name");
  const map = new Map<string, string>();
  for (const row of (data ?? []) as { id: string; name: string }[]) {
    map.set(row.name.toLowerCase(), row.id);
  }
  deptIdByNameCache = map;
  return map;
}

// Resolve an area to its owning department id, or null when the area has no single
// owner (general) or the department isn't present in this project.
export async function resolveDepartmentIdForArea(area: FeedbackArea): Promise<string | null> {
  const name = AREA_DEPARTMENT_NAME[area];
  if (!name) return null;
  const map = await loadDepartmentIdByName();
  return map.get(name.toLowerCase()) ?? null;
}

// Test seam — reset the cache so unit tests can stub a fresh department list.
export function __resetDepartmentCacheForTests() {
  deptIdByNameCache = null;
}
