import { ARABIC_RE, type LisanLookup } from "@/lib/knowledge/lisan-words";
import { isOverviewQuery, parseMajlisRef } from "@/lib/knowledge/religious-topics";

// ─── Fixed reply strings (verbatim, named constants) ─────────────────────────────────────────
export const NOT_FOUND_REPLY =
  "I answer only from the published Ashara Mubaraka reflections, and I couldn't find this there.";

export const THIS_YEAR_OFFER_LAST =
  "This year's reflections (Ashara Mubaraka 1448H) aren't published yet. Would you like last year's (1447H) reflection on this instead?";

// ─── Single-word dictionary pre-route detection ──────────────────────────────────────────────
// Returns the word to look up, plus whether a not-found should still be answered deterministically
// (`forceAnswer`). Latin bare tokens use forceAnswer=false so a non-dictionary word (e.g. a
// logistics term like "parking") falls through to the normal path instead of getting a dict
// not-found. Explicit "meaning of X" asks and Arabic-script tokens force an answer.
export function maybeSingleWordQuery(message: string): { word: string; forceAnswer: boolean } | null {
  const m = message.trim();
  if (!m) return null;

  // Explicit word-meaning asks: "what does X mean", "meaning of X", "define/translate X".
  let mm = m.match(/^(?:what\s+(?:does|is)\s+|what'?s\s+|meaning\s+of\s+|define\s+|translate\s+)["']?([^\s"']{2,40})["']?(?:\s+mean)?\s*[?]?$/i);
  if (mm) return { word: stripPunct(mm[1]), forceAnswer: true };
  // Lisan/Gujarati: "X ni (su) maana", "X no/nu matlab".
  mm = m.match(/^["']?([^\s"']{2,40})["']?\s+(?:ni|no|nu)\s+(?:su\s+|shu\s+)?(?:maana|maena|matlab|meaning)(?:\s+che)?\s*[?]?$/i);
  if (mm) return { word: stripPunct(mm[1]), forceAnswer: true };

  // Bare single token.
  if (!/\s/.test(m) && m.length >= 2 && m.length <= 40) {
    const w = stripPunct(m);
    if (ARABIC_RE.test(w)) return { word: w, forceAnswer: true }; // Lisan script → definitely a word
    if (/^[a-z'’-]{2,40}$/i.test(w)) return { word: w, forceAnswer: false }; // Latin → only answer on a hit
  }
  return null;
}

function stripPunct(s: string): string {
  return s.replace(/^["'’]+|["'’?!.,؟]+$/g, "").trim();
}

// Render a dictionary lookup deterministically (WhatsApp markup), so a single-word lookup never
// needs the model. Source line only on a real hit.
export function renderLisanReply(lookup: LisanLookup): string {
  if (lookup.status === "ok") {
    const lines = lookup.matches.slice(0, 3).map((e) => {
      const head = `*${e.transliteration ?? ""}*${e.lisan ? ` (_${e.lisan}_)` : ""} — ${e.meaning ?? ""}`.trim();
      return e.example ? `${head}\nExample: ${e.example}` : head;
    });
    return `${lines.join("\n")}\n\nSource: Lisan ud Dawat dictionary`;
  }
  if (lookup.status === "did_you_mean") {
    const list = lookup.suggestions
      .slice(0, 3)
      .map((e, i) => `${i + 1}. *${e.transliteration ?? ""}*${e.lisan ? ` (_${e.lisan}_)` : ""}`)
      .join("\n");
    return `I don't have that exact word.\n${list}\nReply with the number for its meaning.`;
  }
  return "I don't have that word in the dictionary. If you share the sentence it's from, I'll try to help.";
}

// ─── Did-you-mean numeric follow-up (A5, history-derived) ────────────────────────────────────
export function isDidYouMeanFollowUp(message: string, lastOutbound: string): boolean {
  return /reply with the number/i.test(lastOutbound) && parseOrdinalPick(message) != null;
}

// Pick the chosen candidate word out of the previous did-you-mean list (parsed from the outbound
// text), by number or ordinal word. Deterministic — never the model.
export function pickDidYouMeanCandidate(message: string, lastOutbound: string): string | null {
  const idx = parseOrdinalPick(message);
  if (idx == null) return null;
  const cands = [...lastOutbound.matchAll(/^\s*(\d+)\.\s*\*([^*]+)\*/gm)].map((x) => x[2].trim());
  return cands[idx - 1] ?? null;
}

export function parseOrdinalPick(message: string): number | null {
  const t = message.trim().toLowerCase();
  const num = t.match(/^\(?\s*([1-9])\s*\)?[.)]?$/) || t.match(/\bnumber\s*([1-9])\b/) || t.match(/\b([1-9])(?:st|nd|rd|th)\b/);
  if (num) return parseInt(num[1], 10);
  const ords: Record<string, number> = { first: 1, second: 2, third: 3, one: 1, two: 2, three: 3 };
  for (const k of Object.keys(ords)) if (new RegExp(`\\b${k}\\b`).test(t)) return ords[k];
  return null;
}

// ─── Offer-last "yes" follow-up (A6, history-derived) ────────────────────────────────────────
const AFFIRMATIVE_RE =
  /^(?:yes|yeah|yep|ya|yes please|sure|ok|okay|k|please|kindly|haan|han|ha|ji|ji haan|han ji|bilkul|go ahead|do it|show me|show|sounds good)\b/i;

export function isAffirmative(message: string): boolean {
  const t = message.trim();
  if (!t || t.split(/\s+/).length > 5) return false;
  return AFFIRMATIVE_RE.test(t);
}

// ─── No-tool guard: does the message carry a positive religious/deen signal (A4)? ────────────
// Keyed to catch deen questions ("who is the 53rd dai", "when did the nas happen") while leaving
// logistics and ambiguous messages untouched. Social check is applied separately and FIRST.
const RELIGIOUS_SIGNAL_RE =
  /\b(waaz|wa'?az|bayan|sermon|majlis|majalis|ashara|aashura|muharram|moharram|tazyeen|reflection|iqtibas|al[\s-]?dars|duroos|lisan|imam|husain|hussain|hasan|fatema|fatima|karbala|shahadat|shahaadat|maula|aqa|dai|du'?aat|nas|mansoos|deen|namaz|namaaz|roza|matam|maatam|ziyarat|sajda|quran|qur'?an|hadith|ayat|surah|aqaid|shariat|tariqat|haqiqat)\b/i;

export function hasReligiousSignal(message: string): boolean {
  if (RELIGIOUS_SIGNAL_RE.test(message)) return true;
  return parseMajlisRef(message) != null || isOverviewQuery(message);
}

// ─── Clearly-social messages (greeting / thanks / dua / chant / bare affirmation) → pass ─────
const SOCIAL_RE =
  /^(?:\s*(?:(?:as+|wa\s+)?salaam?(?:\s*un)?(?:\s*(?:alaikum|jameel))?|salam|adaab|hi|hello|hey|good\s+(?:morning|evening|afternoon)|shukran|thanks?|thank\s+you|jazakallah|jazakumullah|aameen|ameen|mola(?:\s+mola)*(?:\s+mufaddal)?(?:\s+mola)?|ya\s+ali\s+madad|ya\s+husain|inshallah|insha'?allah|mashallah|subhanallah|alhamdulillah|ok|okay|k|sure|nothing|np|👍|🙏|❤️|🤲)\s*[.!]*\s*)+$/i;

export function isClearlySocial(message: string): boolean {
  const t = message.trim();
  if (!t) return true;
  if (SOCIAL_RE.test(t)) return true;
  // A short dua/blessing wish.
  if (t.split(/\s+/).length <= 6 && /\b(dua\s+ma\s+yaad|yaad\s+rakhjo|dua\s+ni\s+iltemas|dua\s+ma)\b/i.test(t)) return true;
  return false;
}

// ─── Hijri-year label post-check (step 8) ────────────────────────────────────────────────────
export function extractHijriYears(text: string): string[] {
  return [...text.matchAll(/\b(14[3-9]\d|140\d|14[0-2]\d)\s*h?\b/gi)].map((m) => m[1]);
}

// True when the reply's stated Hijri year conflicts with the source row's year. For a null
// source year (e.g. the guardrail/misc block), ANY stated Hijri year is a conflict.
export function yearLabelMismatch(reply: string, sourceYear: string | null): boolean {
  const years = extractHijriYears(reply);
  if (sourceYear == null) return years.length > 0;
  return years.some((y) => y !== sourceYear);
}
