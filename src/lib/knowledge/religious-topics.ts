import { deleteReligiousContent, indexReligiousTopic, type ReligiousMeta } from "@/lib/knowledge/index-content";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export type ReligiousCategory =
  | "reflection" | "tazyeen" | "al_dars" | "jumla" | "kalema" | "unwaan" | "misc";
export type ReligiousLanguage = "en" | "lisan";
export type ReligiousStatus = "indexed" | "pending_translation" | "placeholder";

export type ReligiousTopic = {
  id: string;
  slug: string;
  title: string;
  content: string;
  chunk_count: number;
  entry_count: number;
  sort_order: number;
  source_url: string | null;
  source_label: string | null;
  year_hijri: string | null;
  majlis_number: number | null;
  is_ashura: boolean;
  category: ReligiousCategory | null;
  language: ReligiousLanguage;
  status: ReligiousStatus;
  updated_at: string | null;
};

// Metadata accepted when creating/seeding a per-majlis topic block.
export type TopicMeta = {
  yearHijri?: string | null;
  majlisNumber?: number | null;
  isAshura?: boolean | null;
  category?: ReligiousCategory | null;
  language?: ReligiousLanguage | null;
  status?: ReligiousStatus | null;
  sourceUrl?: string | null;
  sourceLabel?: string | null;
  sortOrder?: number | null;
};

const TOPIC_SELECT =
  "id, slug, title, content, chunk_count, sort_order, source_url, source_label, " +
  "year_hijri, majlis_number, is_ashura, category, language, status, updated_at";

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
    .select(TOPIC_SELECT)
    .order("sort_order")
    .order("title");
  if (error) throw error;

  return ((data ?? []) as unknown as Omit<ReligiousTopic, "entry_count">[]).map((t) => ({
    ...t,
    entry_count: countEntries(t.content ?? ""),
  }));
}

// Lisan ud Dawat blocks awaiting an English translation (for the dashboard queue + the
// daily translation digest). Optionally scoped to one Ashara year.
export async function listPendingTranslations(year?: string): Promise<ReligiousTopic[]> {
  const all = await listReligiousTopics();
  return all.filter((t) => t.status === "pending_translation" && (!year || t.year_hijri === year));
}

// Create a new (empty) religious topic block with a unique slug, optionally carrying
// per-majlis metadata (used by the Ashara dashboard / daily seed).
export async function createReligiousTopic(title: string, meta: TopicMeta = {}): Promise<{ id: string; slug: string }> {
  const supabase = getSupabaseAdmin();
  const base = slugify(title);

  // Ensure slug uniqueness against existing topics.
  const { data: existing } = await supabase.from("religious_topics").select("slug");
  const taken = new Set((existing ?? []).map((r) => r.slug as string));
  let slug = base;
  let n = 2;
  while (taken.has(slug)) slug = `${base}-${n++}`;

  let sortOrder = meta.sortOrder ?? null;
  if (sortOrder == null) {
    const { data: maxRow } = await supabase
      .from("religious_topics")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    sortOrder = ((maxRow?.sort_order as number) ?? 0) + 1;
  }

  const row: Record<string, unknown> = { slug, title, sort_order: sortOrder };
  if (meta.yearHijri !== undefined) row.year_hijri = meta.yearHijri;
  if (meta.majlisNumber !== undefined) row.majlis_number = meta.majlisNumber;
  if (meta.isAshura !== undefined) row.is_ashura = meta.isAshura ?? false;
  if (meta.category !== undefined) row.category = meta.category;
  if (meta.language !== undefined) row.language = meta.language ?? "en";
  if (meta.status !== undefined) row.status = meta.status ?? "placeholder";
  if (meta.sourceUrl !== undefined) row.source_url = meta.sourceUrl;
  if (meta.sourceLabel !== undefined) row.source_label = meta.sourceLabel;

  const { data, error } = await supabase
    .from("religious_topics")
    .insert(row)
    .select("id, slug")
    .single();
  if (error) throw error;
  return { id: data.id as string, slug: data.slug as string };
}

// Save a topic's text (and optional source link) and re-index it into the vector store.
export async function saveReligiousTopic(
  topicId: string,
  content: string,
  updatedBy: string | null,
  source?: { sourceUrl?: string | null; sourceLabel?: string | null },
): Promise<{ chunk_count: number }> {
  const supabase = getSupabaseAdmin();
  const { data: topic } = await supabase
    .from("religious_topics")
    .select("title, source_url, source_label, year_hijri, majlis_number, is_ashura, category, status")
    .eq("id", topicId)
    .maybeSingle();
  if (!topic) throw new Error("Topic not found");

  // Keep existing source unless the caller provides a new value.
  const sourceUrl = source?.sourceUrl !== undefined ? (source.sourceUrl || null) : (topic.source_url as string | null);
  const sourceLabel = source?.sourceLabel !== undefined ? (source.sourceLabel || null) : (topic.source_label as string | null);

  // Denormalize per-majlis metadata onto the indexed chunks for provenance + filtering.
  const meta: ReligiousMeta = {
    yearHijri: topic.year_hijri as string | null,
    majlisNumber: topic.majlis_number as number | null,
    isAshura: topic.is_ashura as boolean | null,
    category: topic.category as string | null,
  };
  const chunkCount = await indexReligiousTopic(topicId, topic.title as string, content, { sourceUrl, sourceLabel }, meta);

  // Saving real content fulfils a pending-translation / placeholder slot → mark indexed.
  const nextStatus = content.trim() ? "indexed" : (topic.status as string);

  const { error } = await supabase
    .from("religious_topics")
    .update({
      content,
      chunk_count: chunkCount,
      source_url: sourceUrl,
      source_label: sourceLabel,
      status: nextStatus,
      updated_by: updatedBy,
      updated_at: new Date().toISOString(),
    })
    .eq("id", topicId);
  if (error) throw error;
  return { chunk_count: chunkCount };
}

// --- Majlis-by-number lookup (Issue #43) ---
// Vector search ranks "second waaz" / "Majlis 2" poorly (it once returned Majlis 6),
// because a majlis ordinal is a STRUCTURED reference, not a semantic one. So when the
// query names a specific majlis, fetch that exact topic block by its title instead.

const ORDINALS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
  sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
};
const MAJLIS_WORDS = "majlis|majlas|majlas|waaz|waaz|vaaz|va'az|bayan|sermon";

export type MajlisRef = {
  lailat: boolean;
  majlisNum: number | null;
  wantsTazyeen: boolean;
  wantsDars: boolean;
  // Specific daily category, if named ("jumla of majlis 2", "majlis 3 kalema").
  wantsCategory: "jumla" | "kalema" | "unwaan" | null;
  year: string | null;
};

// Parse a free-text query for a specific majlis reference. Returns null if none.
export function parseMajlisRef(query: string): MajlisRef | null {
  const q = ` ${query.toLowerCase()} `;
  const wantsTazyeen = /\b(tazyeen|tazeen|tazyin|decorat|sajawat|sajaawat|artwork|calligraph)/.test(q);
  // Al-Dars = the "Learning Canvas" deep-dive chapters (Falak-e-Muhit, 5 Duroos, etc.).
  const wantsDars = /\b(al[\s-]?dars|dars|duroos|durus|learning canvas|deep[\s-]?dive|chapter)\b/.test(q);
  // Daily micro-categories (word/sentence/topic of the day).
  const wantsCategory: MajlisRef["wantsCategory"] =
    /\bjumla(tul)?\b/.test(q) ? "jumla"
    : /\bkalema(tul)?\b|\bkalimaat\b|\bkalemat\b/.test(q) ? "kalema"
    : /\bunwaan\b|\bunvaan\b/.test(q) ? "unwaan"
    : null;
  let lailat = /\b(lailat|laylat|aashura|ashura)\b/.test(q);
  let majlisNum: number | null = null;

  // "majlis 3", "waaz no 3", "3rd majlis", "waaz number 3"
  let m = q.match(new RegExp(`\\b(?:${MAJLIS_WORDS})\\s*(?:no\\.?|number|#|:)?\\s*(\\d{1,2})\\b`));
  if (!m) m = q.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:${MAJLIS_WORDS})\\b`));
  if (m) majlisNum = parseInt(m[1], 10);

  // ordinal words: "second waaz", "the third majlis", "waaz ... second"
  if (majlisNum == null) {
    const ord = Object.keys(ORDINALS).join("|");
    const om =
      q.match(new RegExp(`\\b(${ord})\\s+(?:${MAJLIS_WORDS})\\b`)) ||
      q.match(new RegExp(`\\b(?:${MAJLIS_WORDS})\\s+(?:no\\.?|number)?\\s*(${ord})\\b`));
    if (om) majlisNum = ORDINALS[om[1]];
  }

  // Day of Muharram -> majlis. Majlis N is the (N+1)th of Muharram; Ashura (10th) = the 9-10 block.
  if (majlisNum == null && !lailat) {
    const dm = q.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s*(?:muharram|moharram)\b/);
    if (dm) {
      const day = parseInt(dm[1], 10);
      if (day === 10) lailat = true;
      else if (day >= 2 && day <= 9) majlisNum = day - 1;
    }
  }

  // Majlis 9/10 references map to the combined Lailat/Ashura block.
  if (majlisNum === 9 || majlisNum === 10) { lailat = true; majlisNum = null; }

  if (majlisNum == null && !lailat) return null;

  const ym = q.match(/\b(14\d\d)\s*h?\b/);
  return { lailat, majlisNum, wantsTazyeen, wantsDars, wantsCategory, year: ym ? ym[1] : null };
}

// Map a parsed reference to the target content category.
function categoryForRef(ref: MajlisRef): ReligiousCategory {
  if (ref.wantsCategory) return ref.wantsCategory;
  if (ref.wantsDars) return "al_dars";
  if (ref.wantsTazyeen) return "tazyeen";
  return "reflection";
}

type MajlisHit = { title: string; content: string; source_url: string | null };

// Legacy fallback: match by title prefix for any row missing structured metadata.
async function findMajlisByTitle(ref: MajlisRef, category: ReligiousCategory): Promise<MajlisHit[]> {
  const prefixByCat: Partial<Record<ReligiousCategory, RegExp>> = {
    al_dars: /^al-dars/i, tazyeen: /^tazyeen/i, reflection: /^reflections/i,
  };
  const prefix = prefixByCat[category];
  if (!prefix) return [];

  const { data } = await getSupabaseAdmin()
    .from("religious_topics")
    .select("title, content, source_url")
    .order("sort_order");
  const topics = ((data ?? []) as MajlisHit[]).filter((t) => (t.content ?? "").trim());
  return topics.filter((t) => {
    const title = t.title.toLowerCase();
    if (!prefix.test(t.title)) return false;
    if (ref.year && !title.includes(ref.year)) return false;
    if (ref.lailat) return /lailat|aashura|ashura|9\s*[–-]\s*10|9\/10/.test(title);
    return new RegExp(`majlis\\s*0*${ref.majlisNum}(?!\\d)`).test(title);
  });
}

// Resolve a parsed majlis reference to the matching topic block(s) using the structured
// metadata columns (category + majlis_number/is_ashura + year), preferring the most recent
// year. Falls back to title-prefix matching for un-backfilled rows. Returns [] if none.
export async function findMajlisReflection(query: string): Promise<MajlisHit[]> {
  const ref = parseMajlisRef(query);
  if (!ref) return [];
  const category = categoryForRef(ref);

  let q = getSupabaseAdmin()
    .from("religious_topics")
    .select("title, content, source_url, year_hijri")
    .eq("category", category);
  if (ref.year) q = q.eq("year_hijri", ref.year);
  if (ref.lailat) q = q.eq("is_ashura", true);
  else q = q.eq("majlis_number", ref.majlisNum);

  const { data } = await q.order("year_hijri", { ascending: false, nullsFirst: false });
  let rows = ((data ?? []) as (MajlisHit & { year_hijri: string | null })[]).filter((t) => (t.content ?? "").trim());

  // Fallback to legacy title matching if nothing carried structured metadata.
  if (!rows.length) rows = (await findMajlisByTitle(ref, category)) as typeof rows;

  return rows.slice(0, 2).map((t) => ({ title: t.title, content: t.content, source_url: t.source_url ?? null }));
}

// Delete a topic block and its vectorized chunks.
export async function deleteReligiousTopic(topicId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  await deleteReligiousContent("topic", topicId);
  const { error } = await supabase.from("religious_topics").delete().eq("id", topicId);
  if (error) throw error;
}
