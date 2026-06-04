import { getSupabaseAdmin } from "@/lib/supabase/server";

// Record a topic the agent couldn't answer. Repeat questions on the same topic aggregate onto
// one open row (times_seen) so the team sees demand, not duplicates. Used by the live agent tool
// and the manual backfill that scans past conversations.
export async function recordKnowledgeGap(topic: string, question: string | null, phone: string | null) {
  const normalized = topic.toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalized) return { status: "skipped" as const, created: false };
  const supabase = getSupabaseAdmin();
  const { data: existing } = await supabase
    .from("knowledge_gaps")
    .select("id, times_seen, sample_question")
    .eq("normalized_topic", normalized)
    .eq("status", "open")
    .maybeSingle();

  if (existing) {
    await supabase
      .from("knowledge_gaps")
      .update({
        times_seen: (existing.times_seen ?? 1) + 1,
        last_seen_at: new Date().toISOString(),
        last_phone_e164: phone,
        sample_question: existing.sample_question ?? question,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    return { status: "logged" as const, created: false };
  }

  const { error } = await supabase
    .from("knowledge_gaps")
    .insert({ topic: topic.trim(), normalized_topic: normalized, sample_question: question, last_phone_e164: phone });
  if (error) return { status: "error" as const, created: false, error: error.message };
  return { status: "logged" as const, created: true };
}
