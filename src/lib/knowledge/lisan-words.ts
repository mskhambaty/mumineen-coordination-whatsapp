import { getSupabaseAdmin } from "@/lib/supabase/server";

export type LisanEntry = {
  transliteration: string | null;
  lisan: string | null;
  meaning: string | null;
  example: string | null;
};

const ARABIC_RE = /[؀-ۿ]/;

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

export type LisanLookup =
  | { status: "ok"; matches: LisanEntry[] }
  | { status: "did_you_mean"; suggestions: LisanEntry[] }
  | { status: "not_found" };

// Exact dictionary lookup with a fuzzy "did you mean" fallback.
export async function lookupLisanWord(query: string): Promise<LisanLookup> {
  const supabase = getSupabaseAdmin();
  const q = (query ?? "").trim();
  if (!q) return { status: "not_found" };

  // Lisan-script input: match the lisan column directly.
  if (ARABIC_RE.test(q)) {
    const { data } = await supabase
      .from("lisan_words")
      .select("transliteration, lisan, meaning, example")
      .ilike("lisan", `%${q}%`)
      .limit(5);
    const rows = (data ?? []) as LisanEntry[];
    const exact = rows.filter((r) => (r.lisan ?? "").trim() === q);
    if (exact.length) return { status: "ok", matches: exact.slice(0, 3) };
    if (rows.length) return { status: "did_you_mean", suggestions: rows };
    return { status: "not_found" };
  }

  const norm = normalizeWord(q);
  if (!norm) return { status: "not_found" };

  const { data: exactData } = await supabase
    .from("lisan_words")
    .select("transliteration, lisan, meaning, example")
    .eq("norm", norm)
    .limit(3);
  const exact = (exactData ?? []) as LisanEntry[];
  if (exact.length) return { status: "ok", matches: exact };

  // Consonant-skeleton match recovers transliteration variants (sadqe → Sadaqa). A single
  // skeleton hit is confident enough to answer directly; several → numbered "did you mean".
  const skel = skeleton(norm);
  if (skel) {
    const { data: skelData } = await supabase
      .from("lisan_words")
      .select("transliteration, lisan, meaning, example, norm")
      .eq("norm_skeleton", skel)
      .limit(6);
    const skelRows = (skelData ?? []) as (LisanEntry & { norm?: string | null })[];
    if (skelRows.length) {
      const ranked = skelRows
        .slice()
        .sort((a, b) => Math.abs((a.norm ?? "").length - norm.length) - Math.abs((b.norm ?? "").length - norm.length))
        .map(({ transliteration, lisan, meaning, example }) => ({ transliteration, lisan, meaning, example }));
      if (ranked.length === 1) return { status: "ok", matches: ranked };
      return { status: "did_you_mean", suggestions: ranked.slice(0, 4) };
    }
  }

  const { data: sugg } = await supabase.rpc("match_lisan_words", { query_norm: norm, match_count: 4 });
  const suggestions = (sugg ?? []) as LisanEntry[];
  return suggestions.length ? { status: "did_you_mean", suggestions: suggestions.slice(0, 4) } : { status: "not_found" };
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
      return {
        transliteration,
        lisan,
        meaning: (r.meaning ?? "").trim() || null,
        example: (r.example ?? "").trim() || null,
        norm,
        norm_skeleton: skeleton(norm),
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
