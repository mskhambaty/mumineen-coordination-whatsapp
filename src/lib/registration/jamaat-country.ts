// Best-effort mapping of a Bohra jamaat (free-text city/mohalla name) to a country, for the
// "coming from" origin breakdown on the registration analytics page. There is no country field in
// the roster; the community is overwhelmingly India-based with a finite, well-known set of overseas
// centers, so we recognize those by keyword and default the remainder to India.
//
// This is a HEURISTIC: extend the rule list as new jamaats appear. Validated against the live
// roster (totals reconcile; ~46% India, the rest spread across Gulf / East Africa / Pakistan /
// SE Asia / Australia / USA). Order matters only in that the first matching rule wins.
const RULES: { country: string; re: RegExp }[] = [
  { country: "Pakistan", re: /hyderabad sind|\bkhi\b|karachi|rawalpindi|multan|lahore|quetta/i },
  { country: "UAE", re: /dubai|shareqa|sharjah|abu dhabi|ajman|al ain/i },
  { country: "Kuwait", re: /kuwait/i },
  { country: "Bahrain", re: /bahrain/i },
  { country: "Oman", re: /muscat/i },
  { country: "Saudi Arabia", re: /jeddah|makkah|madinah|riyadh/i },
  { country: "Yemen", re: /sanaa/i },
  { country: "Egypt", re: /cairo/i },
  { country: "Kenya", re: /nairobi|mombasa|nakuru|eldoret/i },
  { country: "Uganda", re: /kampala/i },
  { country: "Tanzania", re: /daressalaam|dar es salaam|moshi|arusha/i },
  { country: "Madagascar", re: /tananarive|tulear|sambava/i },
  { country: "Singapore", re: /singapore/i },
  { country: "Malaysia", re: /kuala lumpur|klang/i },
  { country: "Sri Lanka", re: /colombo/i },
  { country: "Bangladesh", re: /dhaka|chittagong/i },
  { country: "Australia", re: /sydney|adelaide|melbourne|perth/i },
  { country: "USA", re: /detroit|detrioit|houston/i },
];

// Returns the mapped country, or null when the jamaat is blank (unknown origin).
export function jamaatCountry(jamaat: string | null): string | null {
  const j = jamaat?.trim();
  if (!j) return null;
  for (const { country, re } of RULES) {
    if (re.test(j)) return country;
  }
  return "India";
}
