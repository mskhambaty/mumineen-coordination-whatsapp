import { AI_MODEL, getAIClient } from "@/lib/ai/model";
import { deleteKnowledgeChunks, indexFaqBucket, knowledgePageUrl } from "@/lib/knowledge/index-content";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export type FaqBucket = {
  department_id: string;
  department_name: string;
  content: string;
  chunk_count: number;
  entry_count: number;
  updated_at: string | null;
};

// Count Q&A entries in bucket text (entries are separated by blank lines).
function countEntries(content: string): number {
  return content
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean).length;
}

// All departments with their FAQ bucket content (empty string if no bucket yet).
export async function listFaqBuckets(): Promise<FaqBucket[]> {
  const supabase = getSupabaseAdmin();
  const [{ data: departments }, { data: buckets }] = await Promise.all([
    supabase.from("departments").select("id, name").order("name"),
    supabase.from("faq_buckets").select("department_id, content, chunk_count, updated_at"),
  ]);

  const byDept = new Map(
    (buckets ?? []).map((b) => [b.department_id as string, b]),
  );

  return ((departments ?? []) as { id: string; name: string }[]).map((dept) => {
    const bucket = byDept.get(dept.id);
    const content = (bucket?.content as string) ?? "";
    return {
      department_id: dept.id,
      department_name: dept.name,
      content,
      chunk_count: (bucket?.chunk_count as number) ?? 0,
      entry_count: countEntries(content),
      updated_at: (bucket?.updated_at as string) ?? null,
    };
  });
}

// Save a department's FAQ bucket text and re-index it into the vector store.
export async function saveFaqBucket(
  departmentId: string,
  content: string,
  updatedBy: string | null,
): Promise<{ chunk_count: number }> {
  const supabase = getSupabaseAdmin();
  const { data: dept } = await supabase.from("departments").select("name").eq("id", departmentId).maybeSingle();
  if (!dept) throw new Error("Department not found");

  const chunkCount = await indexFaqBucket(departmentId, dept.name as string, content);

  const { error } = await supabase.from("faq_buckets").upsert(
    {
      department_id: departmentId,
      content,
      chunk_count: chunkCount,
      updated_by: updatedBy,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "department_id" },
  );
  if (error) throw error;
  return { chunk_count: chunkCount };
}

type LearnedDoc = { id: string; question: string; answer: string };

// One-time: sort the loose "Learned from chat" FAQ documents into department buckets
// using the model to classify each, append them, re-index, and remove the loose docs.
export async function migrateLearnedFaqs(): Promise<{ migrated: number; departments: number }> {
  const supabase = getSupabaseAdmin();

  const { data: docs } = await supabase
    .from("knowledge_documents")
    .select("id, title")
    .eq("file_type", "faq");
  if (!docs || docs.length === 0) return { migrated: 0, departments: 0 };

  // Pull each doc's Q&A text from its indexed chunk.
  const learned: LearnedDoc[] = [];
  for (const doc of docs as { id: string; title: string }[]) {
    const { data: chunkRows } = await supabase
      .from("site_content")
      .select("content")
      .eq("page_url", knowledgePageUrl(doc.id))
      .limit(1);
    const text = (chunkRows?.[0]?.content as string) ?? `Q: ${doc.title}`;
    learned.push({ id: doc.id, question: doc.title, answer: text });
  }

  const { data: departments } = await supabase.from("departments").select("id, name").order("name");
  const deptList = (departments ?? []) as { id: string; name: string }[];
  const assignments = await classifyToDepartments(
    learned.map((l) => l.question),
    deptList.map((d) => d.name),
  );

  // Group Q&A text by the assigned department name.
  const deptByName = new Map(deptList.map((d) => [d.name.toLowerCase(), d]));
  const additions = new Map<string, string[]>(); // department_id -> entries
  for (let i = 0; i < learned.length; i++) {
    const deptName = assignments[i];
    const dept = deptName ? deptByName.get(deptName.toLowerCase()) : undefined;
    if (!dept) continue;
    const list = additions.get(dept.id) ?? [];
    list.push(learned[i].answer.trim());
    additions.set(dept.id, list);
  }

  // Append to each bucket's existing content and re-index.
  let touchedDepartments = 0;
  for (const [deptId, entries] of additions) {
    const { data: existing } = await supabase
      .from("faq_buckets")
      .select("content")
      .eq("department_id", deptId)
      .maybeSingle();
    const prior = (existing?.content as string) ?? "";
    const merged = [prior.trim(), entries.join("\n\n")].filter(Boolean).join("\n\n");
    await saveFaqBucket(deptId, merged, "migration");
    touchedDepartments++;
  }

  // Remove the loose learned-FAQ documents (and their chunks) now that they're bucketed.
  for (const doc of learned) {
    await deleteKnowledgeChunks(doc.id).catch(() => {});
    await supabase.from("knowledge_documents").delete().eq("id", doc.id);
  }

  return { migrated: learned.length, departments: touchedDepartments };
}

// Ask the model to assign each question to the best-fitting department name.
export async function classifyToDepartments(questions: string[], departmentNames: string[]): Promise<(string | null)[]> {
  if (questions.length === 0) return [];
  const client = getAIClient();
  const res = await client.chat.completions.create({
    model: AI_MODEL,
    messages: [
      {
        role: "system",
        content:
          "You assign each visitor FAQ to the single best-fitting department for an Ashara Mubarak (Chicago) event. " +
          "Choose ONLY from the provided department names. Return JSON: {\"assignments\":[{\"index\":<number>,\"department\":\"<exact department name>\"}]}. " +
          "If none fits well, use the closest reasonable one.",
      },
      {
        role: "user",
        content:
          `Departments: ${departmentNames.join(", ")}\n\nQuestions:\n` +
          questions.map((q, i) => `${i}. ${q}`).join("\n"),
      },
    ],
    temperature: 0,
    max_tokens: 1000,
    response_format: { type: "json_object" },
  });

  const out: (string | null)[] = questions.map(() => null);
  try {
    const parsed = JSON.parse(res.choices[0]?.message?.content ?? "{}") as {
      assignments?: { index?: number; department?: string }[];
    };
    for (const a of parsed.assignments ?? []) {
      if (typeof a.index === "number" && a.index >= 0 && a.index < out.length && typeof a.department === "string") {
        out[a.index] = a.department;
      }
    }
  } catch {
    // leave unassigned on parse failure
  }
  return out;
}
