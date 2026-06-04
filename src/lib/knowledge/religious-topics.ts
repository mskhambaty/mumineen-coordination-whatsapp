import { deleteReligiousContent, indexReligiousTopic } from "@/lib/knowledge/index-content";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export type ReligiousTopic = {
  id: string;
  slug: string;
  title: string;
  content: string;
  chunk_count: number;
  entry_count: number;
  sort_order: number;
  updated_at: string | null;
};

// Count Q&A entries in topic text (entries are separated by blank lines).
function countEntries(content: string): number {
  return content
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean).length;
}

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "topic"
  );
}

// All religious topic blocks, ordered for display.
export async function listReligiousTopics(): Promise<ReligiousTopic[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("religious_topics")
    .select("id, slug, title, content, chunk_count, sort_order, updated_at")
    .order("sort_order")
    .order("title");
  if (error) throw error;

  return ((data ?? []) as Omit<ReligiousTopic, "entry_count">[]).map((t) => ({
    ...t,
    entry_count: countEntries(t.content ?? ""),
  }));
}

// Create a new (empty) religious topic block with a unique slug.
export async function createReligiousTopic(title: string): Promise<{ id: string; slug: string }> {
  const supabase = getSupabaseAdmin();
  const base = slugify(title);

  // Ensure slug uniqueness against existing topics.
  const { data: existing } = await supabase.from("religious_topics").select("slug");
  const taken = new Set((existing ?? []).map((r) => r.slug as string));
  let slug = base;
  let n = 2;
  while (taken.has(slug)) slug = `${base}-${n++}`;

  const { data: maxRow } = await supabase
    .from("religious_topics")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const sortOrder = ((maxRow?.sort_order as number) ?? 0) + 1;

  const { data, error } = await supabase
    .from("religious_topics")
    .insert({ slug, title, sort_order: sortOrder })
    .select("id, slug")
    .single();
  if (error) throw error;
  return { id: data.id as string, slug: data.slug as string };
}

// Save a topic's text and re-index it into the religious_content vector store.
export async function saveReligiousTopic(
  topicId: string,
  content: string,
  updatedBy: string | null,
): Promise<{ chunk_count: number }> {
  const supabase = getSupabaseAdmin();
  const { data: topic } = await supabase
    .from("religious_topics")
    .select("title")
    .eq("id", topicId)
    .maybeSingle();
  if (!topic) throw new Error("Topic not found");

  const chunkCount = await indexReligiousTopic(topicId, topic.title as string, content);

  const { error } = await supabase
    .from("religious_topics")
    .update({
      content,
      chunk_count: chunkCount,
      updated_by: updatedBy,
      updated_at: new Date().toISOString(),
    })
    .eq("id", topicId);
  if (error) throw error;
  return { chunk_count: chunkCount };
}

// Delete a topic block and its vectorized chunks.
export async function deleteReligiousTopic(topicId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  await deleteReligiousContent("topic", topicId);
  const { error } = await supabase.from("religious_topics").delete().eq("id", topicId);
  if (error) throw error;
}
