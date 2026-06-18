import { optionalEnv } from "@/lib/env";
import { ARABIC_RE, type LisanLookup, type ReverseLisanLookup } from "@/lib/knowledge/lisan-words";
import { isOverviewQuery, parseMajlisRef } from "@/lib/knowledge/religious-topics";

// ─── Fixed reply strings (verbatim, named constants) ─────────────────────────────────────────
export const NOT_FOUND_REPLY =
  "I answer only from the published Ashara Mubaraka reflections, and I couldn't find this there.";

export const THIS_YEAR_OFFER_LAST =
  "This year's reflections (Ashara Mubaraka 1448H) aren't published yet. Would you like last year's (1447H) reflection on this instead?";

// ─── On-call Istibsaar suggestion ─────────────────────────────────────────────────────────────
// When the bot can't answer a deen question, or after a member has gone several rounds on religious
// topics, point them to the on-call Istibsaar (login with ITS). Deterministic append — the codebase
// never lets the model improvise religious replies. Personal rulings are excluded (Aamil Saheb only).
export const ISTIBSAAR_ONCALL_URL =
  optionalEnv("ISTIBSAAR_ONCALL_URL")?.trim() || "https://www.talabulilm.com/istibsaar/oncall";
export const ON_CALL_SUGGESTION =
  `For a more detailed answer, you can ask your question on the on-call Istibsaar — sign in with your ITS: ${ISTIBSAAR_ONCALL_URL}`;
const ON_CALL_AFTER_INBOUND = 3;

// Append the suggestion to a religious reply. `force` = always (the can't-answer dead-ends); otherwise
// only after >= ON_CALL_AFTER_INBOUND inbound messages (the "deep engagement" trigger). Deduped with
// no new state: skip if a recent outbound in the loaded history already suggested it.
export function appendOnCallSuggestion(
  reply: string,
  history: { direction: string; body: string | null }[],
  opts: { force: boolean },
): string {
  if (history.some((m) => m.direction === "outbound" && (m.body ?? "").includes(ISTIBSAAR_ONCALL_URL))) return reply;
  if (!opts.force && history.filter((m) => m.direction === "inbound").length < ON_CALL_AFTER_INBOUND) return reply;
  return `${reply}\n\n${ON_CALL_SUGGESTION}`;
}

// ─── Reverse dictionary pre-route (English → Lisan word) ─────────────────────────────────────
// Detect an explicit "what is the Lisan word for X" / "what is X in lisan ud dawat" ask and return
// the English term to reverse-look-up. Deliberately requires the literal "lisan … word for" / "in
// lisan" phrasing so it never swallows a forward "what does X mean" lookup (handled below).
const LISAN_UD_DAWAT = String.raw`lisan(?:\s*[-']?\s*(?:ud|ul|e)\s*[-']?\s*dawat)?`;

export function maybeReverseWordQuery(message: string): { english: string } | null {
  const m = message.trim();
  if (!m) return null;

  // "(what is the) lisan (ud dawat) word for/of X"
  let mm = m.match(new RegExp(String.raw`\b${LISAN_UD_DAWAT}\s+word\s+(?:for|of)\s+["']?([a-z][a-z'’\s-]{1,40}?)["']?\s*[?.!]*$`, "i"));
  if (mm) return { english: cleanEnglishTerm(mm[1]) };

  // "what is X in lisan (ud dawat)" / "X in lisan ud dawat" / "how do you/we/i say X in lisan"
  mm = m.match(new RegExp(String.raw`^(?:what(?:'?s| is)\s+(?:the\s+)?|how\s+(?:do\s+(?:you|we|i|u)\s+|to\s+)say\s+)?["']?([a-z][a-z'’\s-]{1,40}?)["']?\s+in\s+${LISAN_UD_DAWAT}\s*[?.!]*$`, "i"));
  if (mm) return { english: cleanEnglishTerm(mm[1]) };

  return null;
}

function cleanEnglishTerm(s: string): string {
  return s.trim().toLowerCase().replace(/^(?:the|a|an)\s+/i, "").replace(/["'’?.!,]+$/g, "").trim();
}

// Render a reverse lookup deterministically (WhatsApp markup). Source line only on a real hit.
export function renderReverseLisanReply(query: string, lookup: ReverseLisanLookup): string {
  if (lookup.status === "ok" && lookup.matches.length) {
    const lines = lookup.matches.slice(0, 3).map((e) =>
      `*${e.transliteration ?? ""}*${e.lisan ? ` (_${e.lisan}_)` : ""}${e.meaning ? ` — ${e.meaning}` : ""}`.trim(),
    );
    const head =
      lines.length > 1 ? `Lisan ud Dawat words for *${query}*:` : `The Lisan ud Dawat word for *${query}* is:`;
    return `${head}\n${lines.join("\n")}\n\nSource: Lisan ud Dawat dictionary`;
  }
  return `I don't have a Lisan ud Dawat word for *${query}* in the dictionary. If you share a sentence or more context, the team can help.`;
}

// ─── Single-word dictionary pre-route detection ──────────────────────────────────────────────
// Returns the word to look up, plus whether a not-found should still be answered deterministically
// (`forceAnswer`). Latin bare tokens use forceAnswer=false so a non-dictionary word (e.g. a
// logistics term like "parking") falls through to the normal path instead of getting a dict
// not-found. Explicit "meaning of X" asks and Arabic-script tokens force an answer.
export function maybeSingleWordQuery(message: string): { word: string; forceAnswer: boolean } | null {
  const m = message.trim();
  if (!m) return null;

  // Explicit word-meaning asks: "what does X mean", "what is the meaning of X", "meaning of X",
  // "define/translate X".
  let mm = m.match(/^(?:what\s+(?:does|is)\s+(?:the\s+meaning\s+of\s+)?|what'?s\s+(?:the\s+meaning\s+of\s+)?|meaning\s+of\s+|define\s+|translate\s+)["']?([^\s"']{2,40})["']?(?:\s+mean)?\s*[?]?$/i);
  if (mm) return { word: stripPunct(mm[1]), forceAnswer: true };
  // "X meaning" / "X means" / "X mean".
  mm = m.match(/^["']?([^\s"']{2,40})["']?\s+(?:meaning|means|mean)\s*[?]?$/i);
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
// NOTE: "ashara" (the event name) is intentionally NOT a religious signal — it appears in
// almost every logistics question (e.g. "my Ashara raza got transferred"), so it was wrongly
// routing registration/account questions to the religious-only path. Keep "aashura" (the day).
const RELIGIOUS_SIGNAL_RE =
  /\b(waaz|wa'?az|bayan|sermon|majlis|majalis|aashura|muharram|moharram|tazyeen|reflection|iqtibas|al[\s-]?dars|duroos|lisan|imam|husain|hussain|hasan|fatema|fatima|karbala|shahadat|shahaadat|maula|aqa|dai|du'?aat|nas|mansoos|deen|namaz|namaaz|roza|matam|maatam|ziyarat|sajda|quran|qur'?an|hadith|ayat|surah|aqaid|shariat|tariqat|haqiqat)\b/i;

export function hasReligiousSignal(message: string): boolean {
  if (RELIGIOUS_SIGNAL_RE.test(message)) return true;
  return parseMajlisRef(message) != null || isOverviewQuery(message);
}

// ─── Own-attendance / meal-RSVP intent (A1 routing guard) ────────────────────────────────────
// A possessive/attendance question — even when it names a Moharram day (each day is BOTH a jaman
// event and a majlis) — is a meal-RSVP question, NOT religious content. Used to (a) steer the model
// to the RSVP tool, and (b) make sure a mis-routed RSVP question never gets the religious-only
// "I answer only from published reflections" not-found reply. Eval case: "What is my RSVP for 4th
// Moharram" was answered with a religious not-found.
const OWN_RSVP_RE =
  /\b(?:my|our|mera|meri|hamara|hamari|amaro|amari)\b[^.?!\n]{0,32}\b(?:rsvp|attend(?:ing|ance|ed)?|sign(?:ed)?\s*up|registrat\w*|registered|coming|down\s+for)\b/i;
const OWN_RSVP_PHRASE_RE =
  /\b(?:what(?:'?s| is| did i)\s+(?:my|our)\s+rsvp|did\s+(?:i|we)\s+(?:sign\s*up|register|rsvp)|are\s+we\s+(?:attending|coming|down\s+for)|am\s+i\s+attending|change\s+(?:my|our)\s+rsvp)\b/i;

export function looksLikeOwnRsvpIntent(message: string): boolean {
  const m = message.trim();
  if (!m) return false;
  return OWN_RSVP_RE.test(m) || OWN_RSVP_PHRASE_RE.test(m);
}

// ─── Clearly-social messages (greeting / thanks / dua / chant / bare affirmation) → pass ─────
const SOCIAL_RE =
  /^(?:\s*(?:(?:as+|wa\s+)?salaam?(?:\s*un)?(?:\s*(?:alaikum|jameel))?|salam|adaab|hi|hello|hey|good\s+(?:morning|evening|afternoon)|shukran|thanks?|thank\s+you|jazakallah|jazakumullah|aameen|ameen|mola(?:\s+mola)*(?:\s+mufaddal)?(?:\s+mola)?|ya\s+ali\s+madad|ya\s+husain|inshallah|insha'?allah|mashallah|subhanallah|alhamd[ou]l+il+a+h?|no|nope|nahi|nai|na|ok|okay|k|sure|nothing|np|👍|🙏|❤️|🤲)\s*[.!]*\s*)+$/i;

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
