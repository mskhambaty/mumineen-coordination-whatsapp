import { AI_MODEL, chatParams, getAIClient } from "@/lib/ai/model";
import { getSupabaseAdmin } from "@/lib/supabase/server";

// --- Personal religious-ruling guard ---------------------------------------------------------
// A personal fiqh / halal-haram / "do I need to" question is NOT something this assistant (or the
// event team) may answer — it belongs with the Aamil Saheb. We detect it BEFORE the model can
// opine (the model has repeatedly issued its own rulings, e.g. "dragon fruit is halal"), reply
// with a fixed refusal, and quietly FLAG it for awareness. Flagging is deliberately distinct from
// escalation: no on-call ping, no "pending" hand-off — just a logged row the team can review.

export const RULING_REFUSAL_REPLY =
  "For a personal ruling like this, please ask your Aamil Saheb — that's the right place for proper guidance. I can only share from the published Ashara Mubaraka reflections, so I'm not able to answer this one myself.";

export type RulingDetection = { ruling: boolean; via: "keyword" | "classifier" | "logistics" | "none" };

// Ruling-INTENT patterns — they key on the *ask for a personal normative ruling*
// (halal/haram, wajib/farz, permissibility, "should I personally do <religious act>"),
// NOT on topic words. So "what did Maula say about fasting in Majlis 5" (a content question)
// does NOT match, while "is dragon fruit halal" / "do I need to fast" do.
const RULING_PATTERNS: RegExp[] = [
  // Explicit fiqh verdict vocabulary (English + common Lisan/Arabic loanwords).
  /\b(halal|haraam|haram|makruh|makrooh|mubah)\b/i,
  /\b(wajib|waajib|farz|fardh|fard|jaiz|jaaez|naajaiz|na-?jaiz)\b/i,
  /\b(fatwa|fatwah|permissible|impermissible|obligatory|mandatory|compulsory|sinful|gunah|gunaah)\b/i,
  // Permissibility / obligation phrasing. NOTE: "do i/we need to" must be followed by a
  // religious act — otherwise logistics ("do I need to register / provide a raza letter")
  // was wrongly caught as a fatwa and refused.
  /\b(is it (allowed|permitted|permissible)|am i allowed|are we allowed|(do (i|we) )?need(ed)? to (fast|pray|wear|observe|keep\s+roza|keep\s+fast|do\s+matam))\b/i,
  // "should/do/must/can I|we|women|men <religious act>"
  /\b(do|should|must|can|may)\s+(i|we|one|she|he|women|men|ladies|a\s+\w+)\b[^?]*\b(fast|roza|namaz|namaaz|pray|matam|maatam|wear|observe|keep\s+roza)\b/i,
  // Lisan/Gujarati: "... che ke nai" (is it / isn't it), "farz che", "karva joiye" (should one do).
  /\bche\s+ke\s+na(i|hi)\b/i,
  /\b(farz|jaiz|wajib|halal|haram)\s+che\b/i,
  /\b(karva|karwa|rakhva|rakhwa|farz)\s+joiye\b/i,
];

// Deterministic fast-path: true when the message clearly asks for a ruling. No LLM call.
export function rulingKeywordHit(message: string): boolean {
  const m = ` ${message.toLowerCase()} `;
  return RULING_PATTERNS.some((re) => re.test(m));
}

// Cheap pre-filter: is the message even permission/obligation-shaped? Only then is it worth an
// LLM classifier call. Keeps the classifier off the vast majority of messages (closings,
// statements, logistics, content questions) so we don't add a model call to every single reply.
const MAYBE_RULING_RE =
  /\b(is it|are we|am i|can i|can we|should i|should we|do i|do we|may i|allowed|supposed to|permitted|permissible|ok to|okay to|need to|have to)\b/i;

export function maybeRulingShaped(message: string): boolean {
  return MAYBE_RULING_RE.test(` ${message.toLowerCase()} `);
}

// --- Logistics allow-list (deterministic rescue) ---------------------------------------------
// Clear event-logistics / accommodation / accessibility questions are NOT fatwas and must never
// be refused. The classifier is deliberately cautious ("unsure → refuse a possible ruling"), so
// without this, a logistics message phrased like "I will need to sit with him for his personal
// needs" trips the obligation pre-filter ("need to") and the cautious classifier refuses it.
//
// IMPORTANT: this list is DERIVED FROM the live `site_content` FAQ topics (accommodation, hotels,
// transport, parking, arrival, venue, timings, wifi, bathrooms, dress code, registration, mawaid,
// medical/Sehhat, seating, laundry, security, khidmat, contact, etc.) plus the seating/accessibility
// vocabulary from the reported false-positive. GROW IT as new FAQs are added.
//
// It only ever short-circuits to ruling:FALSE, and it runs AFTER the explicit-ruling keyword
// fast-path (so "is it halal to eat at the mawaid" still refuses). It never forces ruling:true,
// so a logistics false-match can only ever let a message through to the normal tools — never
// fabricate a ruling. Bare religious-act tokens (namaz/quran/fajr/waaz) are intentionally NOT
// here; they're only logistics in a timing context, which the timing phrases below capture.
const LOGISTICS_RE =
  /\b(accommodation|accomodation|utaro|utara|mehmaan|mehman|host\s*family|rehvani|rehevani|hotel|hotels|econo\s*lodge|red\s*roof|holiday\s*inn|best\s*western|willowbrook|booking|check[\s-]?in|transport|transportation|shuttle|uber|lyft|car\s*pool|carpool|pick[\s-]?up|drop[\s-]?off|parking|airport|arrival|reception|welcome\s*desk|venue|directions|markaz|wifi|wi[\s-]?fi|internet|bathroom|washroom|restroom|toilet|dress\s*code|libas|what\s+to\s+wear|what\s+to\s+pack|raza|registration|register|mawaid|jaman|thaal|niyaz|medical|doctor|sehhat|medicine|first\s*aid|mahal\s*us\s*shifa|wheelchair|walker|accessibility|accessible|disabled|elderly|mobility|personal\s+need|seat|seating|\bsit\b|chair|bench|sehan|last\s*row|front\s*row|where\s+to\s+sit|laundry|lost\s*(and|&)\s*found|khidmat|volunteer|helpline|nazafat|shuttle)\b|\b(what\s+time|when\s+does|when\s+is|timing|timings|schedule)\b/i;

// True when the message is clearly about event logistics / accommodation / accessibility — i.e.
// answerable from the FAQ store or the utaro flow, never a personal fatwa.
export function looksLogistics(message: string): boolean {
  return LOGISTICS_RE.test(` ${message.toLowerCase()} `);
}

// Decide whether a message is a personal religious ruling. Keyword fast-path first (free,
// deterministic); otherwise a cheap classifier catches paraphrase / Lisan the regex misses.
// Never throws. On classifier error it returns false — the fast-path already guarantees the
// explicit cases, and the prompt grounding rule + output sanitizer backstop the rest.
export async function isPersonalRuling(message: string): Promise<RulingDetection> {
  const trimmed = message.trim();
  if (!trimmed) return { ruling: false, via: "none" };
  if (rulingKeywordHit(trimmed)) return { ruling: true, via: "keyword" };
  // Deterministic rescue: a clear logistics/accommodation/accessibility question is never a
  // fatwa. This runs AFTER the keyword fast-path (so explicit halal/haram still refuses) and
  // BEFORE the cautious classifier (which would otherwise refuse anything it's unsure about).
  if (looksLogistics(trimmed)) return { ruling: false, via: "logistics" };
  // Don't spend an LLM call unless the message is at least permission/obligation-shaped.
  if (!maybeRulingShaped(trimmed)) return { ruling: false, via: "none" };

  try {
    const client = getAIClient();
    const res = await client.chat.completions.create({
      ...chatParams(AI_MODEL, { maxTokens: 8, temperature: 0 }),
      messages: [
        {
          role: "system",
          content:
            "You are a safety gate for a Dawoodi Bohra Ashara WhatsApp assistant. Decide whether the " +
            "user's message asks for a PERSONAL RELIGIOUS RULING / fatwa — e.g. whether something is " +
            "halal/haram, wajib/farz/jaiz, obligatory or permitted, or whether they personally should/must " +
            "perform a religious act (fast, pray, matam, wear, etc.). This is NOT a ruling if they are " +
            "asking what a waaz/sermon discussed, asking about event logistics, or asking a word meaning. " +
            "It is ALSO NOT a ruling if they are asking for practical or medical help — e.g. whether/how " +
            "they can see a doctor, use a virtual doctor (Sehhat Connect), get medicine, where to go for " +
            "care, parking, accommodation, transport, registration, or any everyday logistics. Those are " +
            "practical questions, never fatwas — answer false for them. Only answer true when the message " +
            "genuinely seeks a religious/fiqh verdict (halal/haram, wajib/jaiz, permitted/obligatory in deen). " +
            'If genuinely unsure AND the message is about a religious act, answer true; otherwise answer false. ' +
            'Reply with STRICT JSON {"ruling": true|false} and nothing else.',
        },
        { role: "user", content: trimmed.slice(0, 500) },
      ],
    });
    const raw = res.choices[0]?.message?.content?.trim() ?? "";
    const match = raw.match(/\{[\s\S]*\}/);
    const ruling = match ? Boolean((JSON.parse(match[0]) as { ruling?: unknown }).ruling) : false;
    return { ruling, via: ruling ? "classifier" : "none" };
  } catch (err) {
    console.error("isPersonalRuling classifier failed:", err instanceof Error ? err.message : err);
    return { ruling: false, via: "none" };
  }
}

// Quietly record that a ruling question was asked — for team awareness only (NOT an escalation:
// no on-call notification, no pending hand-off). Never throws: a logging failure must never
// break the user's reply. Logs an opaque marker only (no PII).
export async function flagRulingQuestion(
  phoneE164: string,
  message: string,
  via: RulingDetection["via"],
): Promise<void> {
  try {
    await getSupabaseAdmin()
      .from("religious_ruling_flags")
      .insert({
        phone_e164: phoneE164,
        message: message.slice(0, 1000),
        detected_by: via === "classifier" ? "classifier" : "keyword",
      });
  } catch {
    console.error("flagRulingQuestion insert failed");
  }
}
