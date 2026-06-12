import { getSupabaseAdmin } from "@/lib/supabase/server";

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

export type LisanLookup =
  | { status: "ok"; matches: LisanEntry[] }
  | { status: "did_you_mean"; suggestions: LisanEntry[] }
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

export type LisanImportRow = {
  transliteration?: string | null;
  lisan?: string | null;
  meaning?: string | null;
  example?: string | null;
};

// Full-replace import of the dictionary (it's a single authoritative file). Rows without
// any word text are skipped. Returns the number of words inserted.
export async function importLisanWords(rows: LisanImportRow[]): Promise<number> {
  const supabase = getSupabaseAdmin();

  const prepared = rows
    .map((r) => {
      const transliteration = (r.transliteration ?? "").trim() || null;
      const lisan = (r.lisan ?? "").trim() || null;
      const norm = normalizeWord(transliteration ?? lisan ?? "");
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
      };
    })
    .filter((r) => (r.transliteration || r.lisan) && r.norm);

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
