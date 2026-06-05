import { getSupabaseAdmin } from "@/lib/supabase/server";

export type RsvpResponseValue = "yes" | "no" | "maybe";

export type RecordRsvpInput = {
  instanceId: string;
  familyId: string;
  muminId?: string | null;
  response: RsvpResponseValue;
  headCount?: number | null;
  source: "whatsapp" | "admin";
  recordedBy?: string | null;
  phone?: string | null;
};

// Record (or update) a family's RSVP for a Niyaz instance following the append-only / latest-wins
// model. When a submitting mumin is known, we keep a single updatable row per submitter (matching
// the unique (instance, submitted_by_mumin_id) index); otherwise we insert a fresh row.
export async function recordRsvpResponse(input: RecordRsvpInput): Promise<{ id: string }> {
  const supabase = getSupabaseAdmin();
  const headCount = input.response === "yes" ? (input.headCount ?? null) : 0;

  const fields = {
    registration_instance_id: input.instanceId,
    family_id: input.familyId,
    submitted_by_mumin_id: input.muminId ?? null,
    response: input.response,
    head_count: headCount,
    source: input.source,
    recorded_by: input.recordedBy ?? null,
    responded_by_phone: input.phone ?? null,
    submitted_at: new Date().toISOString(),
  };

  // Keep one updatable row per known submitter per instance.
  if (input.muminId) {
    const { data: existing } = await supabase
      .from("rsvp_responses")
      .select("id")
      .eq("registration_instance_id", input.instanceId)
      .eq("submitted_by_mumin_id", input.muminId)
      .maybeSingle();
    if (existing) {
      const { data, error } = await supabase.from("rsvp_responses").update(fields).eq("id", existing.id).select("id").single();
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
  }

  const { data, error } = await supabase.from("rsvp_responses").insert(fields).select("id").single();
  if (error) throw new Error(error.message);
  return { id: data.id };
}
