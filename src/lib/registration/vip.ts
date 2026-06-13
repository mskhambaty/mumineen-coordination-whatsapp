// VIP classification for roster mumineen.
//
// A mumin is a VIP if they belong to a special `category` tier (e.g. Baite Zainy, Qasre Aali —
// the household tiers) OR their `idara` is one of the institutional roles below. The two are
// folded into a single "VIP group" dimension used by the registration analytics page: each group
// label is either the category value or the qualifying idara value.
//
// Idara is matched after stripping a trailing parenthetical qualifier, so workshop/variant tags
// like "Attalimiyah (WH)" or "Azwaaj_Attalimiyah (WH)" fold into their base idara. Keep this set as
// the single source of truth; both the analytics and detail routes import it.
export const VIP_IDARAS = new Set<string>([
  "Ummal Kiram",
  "Ima-e-Fatema",
  "Maqaami Wafd al-Huffaz",
  "Aljamea KHDGZ",
  "Azwaaj Asateza",
  "Attalimiyah",
  "Azwaaj_Aljamea KHDGZ",
  "Maqami_Attalimiyah",
  "Azwaaj_Attalimiyah",
  "Mutadarribaat",
  "Khuddaam",
  "Azwaaj Kothar Mubarak",
]);

// The VIP group label for a member, or null if they are not a VIP. A non-blank `category` wins
// (it's the more specific VIP tier); otherwise a qualifying `idara` supplies the group, with any
// trailing parenthetical qualifier (e.g. " (WH)") stripped so variants map to the base idara.
export function vipGroup(m: { category: string | null; idara: string | null }): string | null {
  const category = m.category?.trim();
  if (category) {
    return category;
  }
  const idara = m.idara?.trim();
  if (idara) {
    const base = idara.replace(/\s*\([^)]*\)\s*$/, "").trim();
    if (VIP_IDARAS.has(base)) {
      return base;
    }
  }
  return null;
}
