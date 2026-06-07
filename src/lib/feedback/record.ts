import { AREA_LABEL, resolveDepartmentIdForArea, type FeedbackArea } from "@/lib/feedback/areas";
import { classifyDepartment } from "@/lib/departments/classify";
import { resolveFamilyForPhone } from "@/lib/rsvp/family";
import { getSupabaseAdmin } from "@/lib/supabase/server";

// Append-only feedback capture. One row per area mentioned, tagged to the owning department
// (resolved from the area) and stamped with the family/phone for the nightly digest. Never
// overwrites prior feedback — sentiment/trends come from the full event stream.

export type Sentiment = "positive" | "neutral" | "negative";

export type FeedbackInput = {
  area: FeedbackArea;
  sentiment?: Sentiment | null;
  rating?: number | null;
  comment?: string | null;
  rawMessage?: string | null;
};

export type RecordFeedbackResult = { recorded: number } | { error: string };

export async function recordFeedback(
  phone: string,
  entries: FeedbackInput[],
  opts: { source: "whatsapp" | "admin"; eventDate?: string | null } = { source: "whatsapp" },
): Promise<RecordFeedbackResult> {
  if (entries.length === 0) return { recorded: 0 };

  // Best-effort family resolution — feedback is still worth capturing even if the number
  // isn't on the roster, so a missing family does not block the insert.
  const family = await resolveFamilyForPhone(phone);
  // Stamp the event_date in the event's timezone (America/Chicago) so it lines up with the nightly
  // digest, which aggregates by the Chicago calendar day.
  const eventDate =
    opts.eventDate ??
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

  const rows = [];
  for (const entry of entries) {
    // Associate the feedback with a department using the LIVE department list + descriptions
    // (classifier), falling back to the static area→department map when nothing clearly fits.
    const classifyText = `${AREA_LABEL[entry.area]}: ${entry.comment ?? entry.rawMessage ?? ""}`;
    const departmentId = (await classifyDepartment(classifyText)) ?? (await resolveDepartmentIdForArea(entry.area));
    rows.push({
      family_id: family?.familyId ?? null,
      mumin_id: family?.muminId ?? null,
      phone_e164: phone,
      area: entry.area,
      department_id: departmentId,
      sentiment: entry.sentiment ?? null,
      rating: entry.rating ?? null,
      comment_text: entry.comment ?? null,
      raw_message: entry.rawMessage ?? null,
      event_date: eventDate,
      source: opts.source,
    });
  }

  const { error } = await getSupabaseAdmin().from("feedback_entries").insert(rows);
  if (error) return { error: error.message };
  return { recorded: rows.length };
}
