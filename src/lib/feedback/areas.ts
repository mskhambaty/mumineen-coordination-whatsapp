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

// Synonyms the LLM tends to use for each area. Anything unmatched falls back to "general" so a
// feedback capture is NEVER dropped over a category mismatch (the original bug: the agent sent
// area "facilities", which 400'd the whole call).
const AREA_SYNONYMS: Record<string, FeedbackArea> = {
  food: "mawaid", mawaid: "mawaid", thaal: "mawaid", jaman: "mawaid", jamaan: "mawaid", niyaz: "mawaid", meal: "mawaid", meals: "mawaid", dinner: "mawaid", lunch: "mawaid", sabeel: "mawaid",
  parking: "parking_transport", transport: "parking_transport", transportation: "parking_transport", shuttle: "parking_transport", traffic: "parking_transport", dropoff: "parking_transport", "drop-off": "parking_transport", bus: "parking_transport", car: "parking_transport",
  audio: "audio_video", video: "audio_video", sound: "audio_video", av: "audio_video", avr: "audio_video", mic: "audio_video", microphone: "audio_video", speaker: "audio_video", screen: "audio_video", relay: "audio_video", livestream: "audio_video",
  accommodation: "accommodation", hotel: "accommodation", utaro: "accommodation", utara: "accommodation", stay: "accommodation", lodging: "accommodation", housing: "accommodation",
  seating: "seating", rahat: "seating", wheelchair: "seating", chairs: "seating", chair: "seating", seat: "seating",
  flow: "flow", crowd: "flow", queue: "flow", line: "flow", entrance: "flow", exit: "flow", "crowd management": "flow", "flow management": "flow", movement: "flow", security: "flow",
};

// Map any string the agent supplies to a valid feedback area, defaulting to "general".
export function normalizeArea(raw: unknown): FeedbackArea {
  if (isFeedbackArea(raw)) return raw;
  if (typeof raw !== "string") return "general";
  const key = raw.trim().toLowerCase();
  if (isFeedbackArea(key)) return key;
  return AREA_SYNONYMS[key] ?? "general";
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
