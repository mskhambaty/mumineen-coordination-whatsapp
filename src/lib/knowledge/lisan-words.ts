import { getSupabaseAdmin } from "@/lib/supabase/server";
import { markWordRequestAdded } from "@/lib/knowledge/lisan-word-requests";

export type LisanEntry = {
  transliteration: string | null;
  lisan: string | null;
  meaning: string | null;
  example: string | null;
};

export const ARABIC_RE = /[؀-ۿ]/;

// Normalize a transliteration for matching: strip diacritics/macrons, lowercase,
// drop punctuation, collapse whitespace. Used identically at import and lookup time.
export function normalizeWord(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Consonant skeleton of a normalized transliteration: drop spaces + vowels and collapse
// runs of the same letter. Dawat transliteration varies the vowels/endings a lot
// ("sadqe"/"sadaqe"/"sadaqah" all share the skeleton "sdq" with "Sadaqa"), so a skeleton
// match recovers words that trigram similarity misses. Empty for all-vowel inputs.
export function skeleton(norm: string): string {
  return norm.replace(/ /g, "").replace(/[aeiou]/g, "").replace(/(.)\1+/g, "$1");
}

// ~7% of dictionary rows bundle several word-forms in one entry, e.g.
// "Ne'mat - Ne'am, An'um" / "نعمة - نعم، انعم". Split on the form separators so each form is
// indexed/searched on its own (the whole-entry norm/skeleton never matches a single word).
export function splitForms(s: string | null | undefined): string[] {
  return (s ?? "").split(/\s+-\s+|[,،/;]/).map((p) => p.trim()).filter(Boolean);
}

// Words to ignore when tokenizing an English meaning into searchable gloss terms (so a reverse
// "Lisan word for X" lookup matches on real content words, not articles/prepositions).
const MEANING_STOPWORDS = new Set([
  "of", "the", "an", "to", "or", "and", "in", "on", "for", "with", "at", "by", "as", "is",
]);

// Tokenize an English meaning gloss into distinct lowercased content words. Mirrors the SQL
// backfill in 20260615220000_lisan_meaning_reverse.sql so a single add and a re-import produce the
// same `meaning_terms`. "Painstaking, hardworking" → ["painstaking","hardworking"].
export function meaningTerms(meaning: string | null | undefined): string[] {
  return Array.from(
    new Set(
      (meaning ?? "")
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 2 && !MEANING_STOPWORDS.has(t)),
    ),
  );
}

export type LisanLookup =
  | { status: "ok"; matches: LisanEntry[] }
  | { status: "did_you_mean"; suggestions: LisanEntry[] }
  | { status: "not_found" };

// Reverse lookup result (English meaning → Lisan word). No "did you mean" tier — a miss is just a
// miss (the query is an English word, not a misspelled Lisan one), so we return a clean not_found.
export type ReverseLisanLookup =
  | { status: "ok"; matches: LisanEntry[] }
  | { status: "not_found" };

// pg_trgm-compatible trigram similarity (2 leading + 1 trailing space, Jaccard on trigrams). Pure
// JS so we can RANK candidates from different recall sources on the same scale the DB uses, and
// unit-test the matcher without a database. Reproduces Postgres `similarity()` exactly.
function trigramSet(s: string): Set<string> {
  const padded = `  ${s.toLowerCase()} `;
  const set = new Set<string>();
  for (let i = 0; i + 3 <= padded.length; i++) set.add(padded.slice(i, i + 3));
  return set;
}
export function trigramSim(a: string, b: string): number {
  if (a === b) return a ? 1 : 0;
  const A = trigramSet(a);
  const B = trigramSet(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}

// Quick replies that are NOT words to look up: bare affirmatives, numbers, or punctuation/1-char.
// A "Yes" or "2" reaching the dictionary tool must NOT come back as a Lisan word (e.g. "Yes" →
// "Yaas, hopelessness"). Caught here so it's blocked no matter who called the lookup.
const TRIVIAL_WORDS = new Set([
  "yes", "yeah", "yep", "ya", "ok", "okay", "k", "sure", "no", "nope", "na", "hi", "hello", "hey",
  "thanks", "thank", "thankyou", "ji", "han", "haan", "ha", "please", "hmm", "hm", "done", "good",
  "nice", "cool", "great", "alright",
]);
export function isTrivialLookup(query: string): boolean {
  const t = (query ?? "").trim().toLowerCase();
  if (!t) return true;
  if (/^[\d\s\p{P}\p{S}]+$/u.test(t)) return true; // numbers / punctuation / symbols only
  if (t.replace(/[^a-z؀-ۿ]/gi, "").length < 2) return true; // fewer than 2 letters
  if (TRIVIAL_WORDS.has(t.replace(/[^a-z]/g, ""))) return true;
  return false;
}

// Relevance bars (pg_trgm scale). TRIGRAM_FLOOR hides misleading look-alikes; STRONG_MATCH answers
// a clear single hit directly; SKELETON_FLOOR is the looser bar for the consonant-skeleton fallback
// (which recovers vowel-dropping variants like sadqe→Sadaqa that score low on trigram).
const TRIGRAM_FLOOR = 0.42;
const STRONG_MATCH = 0.55;
const SKELETON_FLOOR = 0.25;

type Pickable = { transliteration: string | null; lisan: string | null; meaning: string | null; example: string | null };
const pick = (r: Pickable): LisanEntry => ({ transliteration: r.transliteration, lisan: r.lisan, meaning: r.meaning, example: r.example });
const dedupe = (entries: LisanEntry[]): LisanEntry[] => {
  const seen = new Set<string>();
  return entries.filter((e) => {
    const key = `${e.transliteration ?? ""}::${e.lisan ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

// Exact dictionary lookup with a fuzzy "did you mean" fallback.
export async function lookupLisanWord(query: string): Promise<LisanLookup> {
  const supabase = getSupabaseAdmin();
  const q = (query ?? "").trim();
  if (!q) return { status: "not_found" };
  if (isTrivialLookup(q)) return { status: "not_found" }; // "Yes" / "2" / "ok" are not words

  // Lisan-script input: match the lisan column directly.
  if (ARABIC_RE.test(q)) {
    // Exact match against an individual form (handles compound entries like
    // "نعمة - نعم، انعم" where the whole `lisan` field never equals a single word).
    const { data: formData } = await supabase
      .from("lisan_words")
      .select("transliteration, lisan, meaning, example")
      .contains("lisan_forms", [q])
      .limit(3);
    const formRows = (formData ?? []) as LisanEntry[];
    if (formRows.length) return { status: "ok", matches: formRows.slice(0, 3) };

    const { data } = await supabase
      .from("lisan_words")
      .select("transliteration, lisan, meaning, example")
      .ilike("lisan", `%${q}%`)
      .limit(5);
    const rows = (data ?? []) as LisanEntry[];
    const exact = rows.filter((r) => (r.lisan ?? "").trim() === q);
    if (exact.length) return { status: "ok", matches: exact.slice(0, 3) };
    if (rows.length) return { status: "did_you_mean", suggestions: rows.slice(0, 3) };
    return { status: "not_found" };
  }

  const norm = normalizeWord(q);
  if (!norm) return { status: "not_found" };

  // 1. Exact transliteration match.
  const { data: exactData } = await supabase
    .from("lisan_words")
    .select("transliteration, lisan, meaning, example")
    .eq("norm", norm)
    .limit(3);
  const exact = (exactData ?? []) as LisanEntry[];
  if (exact.length) return { status: "ok", matches: exact };

  // 2. Fuzzy (trigram) FIRST — the "looks similar" signal. The RPC filters by pg_trgm and returns
  // a similarity score; we re-rank and apply a floor so only genuinely-close words surface (this is
  // what makes "zohra" → Zohrah, and drops same-skeleton junk like Zeher/Izhaar that score ~0.09).
  const { data: trg } = await supabase.rpc("match_lisan_words", { query_norm: norm, match_count: 8 });
  const trgRanked = ((trg ?? []) as (LisanEntry & { similarity?: number })[])
    .map((r) => ({ entry: pick(r), score: typeof r.similarity === "number" ? r.similarity : trigramSim(norm, normalizeWord(r.transliteration ?? "")) }))
    .filter((c) => c.score >= TRIGRAM_FLOOR)
    .sort((a, b) => b.score - a.score);
  if (trgRanked.length) {
    // One clearly-best match → answer it directly instead of asking "did you mean".
    if (trgRanked[0].score >= STRONG_MATCH && (trgRanked.length === 1 || trgRanked[0].score - trgRanked[1].score >= 0.15)) {
      return { status: "ok", matches: [trgRanked[0].entry] };
    }
    return { status: "did_you_mean", suggestions: dedupe(trgRanked.map((c) => c.entry)).slice(0, 3) };
  }

  // 3. Consonant-skeleton FALLBACK — recovers vowel-dropping variants (sadqe → Sadaqa) that trigram
  // misses. Only consulted when trigram found nothing close. Skeleton hits are still ranked by
  // trigram similarity and floored, so a short/ambiguous skeleton can't surface unrelated words.
  const skel = skeleton(norm);
  if (skel) {
    let { data: skelData } = await supabase
      .from("lisan_words")
      .select("transliteration, lisan, meaning, example, norm")
      .contains("skeleton_forms", [skel])
      .limit(8);
    if (!skelData?.length) {
      ({ data: skelData } = await supabase
        .from("lisan_words")
        .select("transliteration, lisan, meaning, example, norm")
        .eq("norm_skeleton", skel)
        .limit(8));
    }
    const skelRanked = ((skelData ?? []) as (LisanEntry & { norm?: string | null })[])
      .map((r) => ({ entry: pick(r), score: trigramSim(norm, r.norm ?? "") }))
      .filter((c) => c.score >= SKELETON_FLOOR)
      .sort((a, b) => b.score - a.score);
    if (skelRanked.length === 1) return { status: "ok", matches: [skelRanked[0].entry] };
    if (skelRanked.length > 1) return { status: "did_you_mean", suggestions: dedupe(skelRanked.map((c) => c.entry)).slice(0, 3) };
  }

  return { status: "not_found" };
}

// Reverse lookup: given an English word ("brain", "hardworking"), find the Lisan ud Dawat word(s)
// whose meaning matches. Two recall tiers, both reusing the indexes added in
// 20260615220000_lisan_meaning_reverse.sql:
//   1. exact gloss-word match on `meaning_terms` (handles "hardworking" → Jafakash, "back" → Kamar);
//   2. fuzzy word-trigram on `meaning` via the match_lisan_by_meaning RPC ("calm" → "calmness, …").
// A miss returns a clean not_found — never a forward fuzzy guess. The dictionary is Lisan→English
// and small, so most arbitrary English words legitimately have no entry.
export async function lookupEnglishMeaning(query: string): Promise<ReverseLisanLookup> {
  const supabase = getSupabaseAdmin();
  const q = (query ?? "").trim();
  if (!q || isTrivialLookup(q)) return { status: "not_found" };
  const terms = meaningTerms(q);
  if (!terms.length) return { status: "not_found" };

  // 1. Exact gloss-word match. Rank the most specific entries first (fewer gloss words = the query
  // term is a primary meaning, e.g. "back" → Kamar ["back"] over a 5-gloss entry that mentions it).
  const { data: exactData } = await supabase
    .from("lisan_words")
    .select("transliteration, lisan, meaning, example, meaning_terms")
    .overlaps("meaning_terms", terms)
    .limit(12);
  const exact = (exactData ?? []) as (LisanEntry & { meaning_terms?: string[] | null })[];
  if (exact.length) {
    const ranked = exact
      .map((e) => ({ entry: pick(e), specificity: e.meaning_terms?.length ?? 99 }))
      .sort((a, b) => a.specificity - b.specificity);
    return { status: "ok", matches: dedupe(ranked.map((c) => c.entry)).slice(0, 3) };
  }

  // 2. Fuzzy word-trigram over the meaning text (recovers morphological variants).
  const { data: trg } = await supabase.rpc("match_lisan_by_meaning", { query_text: q, match_count: 8 });
  const ranked = ((trg ?? []) as (LisanEntry & { similarity?: number })[])
    .map((r) => ({ entry: pick(r), score: typeof r.similarity === "number" ? r.similarity : 0 }))
    .sort((a, b) => b.score - a.score);
  if (ranked.length) return { status: "ok", matches: dedupe(ranked.map((c) => c.entry)).slice(0, 3) };

  return { status: "not_found" };
}

export type LisanImportRow = {
  transliteration?: string | null;
  lisan?: string | null;
  meaning?: string | null;
  example?: string | null;
};

// A dictionary row with all the computed match columns ready for insert.
export type PreparedLisanRow = {
  transliteration: string | null;
  lisan: string | null;
  meaning: string | null;
  example: string | null;
  norm: string;
  norm_skeleton: string;
  skeleton_forms: string[];
  lisan_forms: string[];
  meaning_terms: string[];
};

// Compute the stored match columns (norm / skeleton / per-form arrays) for ONE raw row, exactly
// as bulk import does — so a single add and a full re-import produce identical, searchable rows.
// Returns null when the row has no usable word text (skip it).
export function prepareLisanRow(r: LisanImportRow): PreparedLisanRow | null {
  const transliteration = (r.transliteration ?? "").trim() || null;
  const lisan = (r.lisan ?? "").trim() || null;
  const norm = normalizeWord(transliteration ?? lisan ?? "");
  if (!(transliteration || lisan) || !norm) return null;
  const skeleton_forms = Array.from(
    new Set(splitForms(transliteration).map((f) => skeleton(normalizeWord(f))).filter(Boolean)),
  );
  const lisan_forms = Array.from(new Set(splitForms(lisan)));
  return {
    transliteration,
    lisan,
    meaning: (r.meaning ?? "").trim() || null,
    example: (r.example ?? "").trim() || null,
    norm,
    norm_skeleton: skeleton(norm),
    skeleton_forms,
    lisan_forms,
    meaning_terms: meaningTerms((r.meaning ?? "").trim() || null),
  };
}

export type AddLisanResult =
  | { status: "added"; entry: LisanEntry; count: number }
  | { status: "updated"; entry: LisanEntry; count: number }
  | { status: "invalid" };

// Add (or update) ONE dictionary word without touching the rest of the table — the day-to-day
// path for filling a gap. The DB is the source of truth; dedupe on `norm` so the same word can't
// be added twice (an existing entry is updated in place instead). Returns the new total count.
export async function addLisanWord(row: LisanImportRow, actorName?: string | null): Promise<AddLisanResult> {
  const prepared = prepareLisanRow(row);
  if (!prepared) return { status: "invalid" };
  const supabase = getSupabaseAdmin();

  // word now exists → close any open request for it, and (if one was waiting) email the team.
  const closeRequest = () =>
    markWordRequestAdded(prepared.norm, {
      label: prepared.transliteration ?? prepared.lisan,
      meaning: prepared.meaning,
      addedBy: actorName ?? null,
    });

  // Dedupe: a row with the same normalized word already exists → update it in place.
  const { data: existing } = await supabase
    .from("lisan_words")
    .select("id")
    .eq("norm", prepared.norm)
    .limit(1);
  const existingId = (existing as { id: number }[] | null)?.[0]?.id;

  if (existingId != null) {
    const { error } = await supabase.from("lisan_words").update(prepared).eq("id", existingId);
    if (error) throw error;
    await closeRequest();
    return { status: "updated", entry: pick(prepared), count: await countLisanWords() };
  }

  const { error } = await supabase.from("lisan_words").insert(prepared);
  if (error) throw error;
  await closeRequest();
  return { status: "added", entry: pick(prepared), count: await countLisanWords() };
}

// Every word in the dictionary, oldest first, for CSV export / backup. Returns the four
// human-authored columns only (the computed match columns are re-derived on import).
export async function listAllLisanWords(): Promise<LisanEntry[]> {
  const { data } = await getSupabaseAdmin()
    .from("lisan_words")
    .select("transliteration, lisan, meaning, example")
    .order("id", { ascending: true });
  return (data ?? []) as LisanEntry[];
}

// Full-replace import of the dictionary (it's a single authoritative file). Rows without
// any word text are skipped. Returns the number of words inserted.
export async function importLisanWords(rows: LisanImportRow[]): Promise<number> {
  const supabase = getSupabaseAdmin();

  const prepared = rows.map(prepareLisanRow).filter((r): r is PreparedLisanRow => r !== null);

  // Replace the whole dictionary atomically-ish: clear then insert in batches.
  await supabase.from("lisan_words").delete().neq("id", 0);

  const BATCH = 500;
  let inserted = 0;
  for (let i = 0; i < prepared.length; i += BATCH) {
    const batch = prepared.slice(i, i + BATCH);
    const { error } = await supabase.from("lisan_words").insert(batch);
    if (error) throw error;
    inserted += batch.length;
  }
  return inserted;
}

export async function countLisanWords(): Promise<number> {
  const { count } = await getSupabaseAdmin()
    .from("lisan_words")
    .select("id", { count: "exact", head: true });
  return count ?? 0;
}
