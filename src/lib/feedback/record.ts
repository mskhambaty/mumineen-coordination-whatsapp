import { resolveDepartmentIdForArea, type FeedbackArea } from "@/lib/feedback/areas";
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
  const eventDate = opts.eventDate ?? new Date().toISOString().slice(0, 10);

  const rows = [];
  for (const entry of entries) {
    rows.push({
      family_id: family?.familyId ?? null,
      mumin_id: family?.muminId ?? null,
      phone_e164: phone,
      area: entry.area,
      department_id: await resolveDepartmentIdForArea(entry.area),
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
