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

export type RulingDetection = { ruling: boolean; via: "keyword" | "classifier" | "none" };

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

// Decide whether a message is a personal religious ruling. Keyword fast-path first (free,
// deterministic); otherwise a cheap classifier catches paraphrase / Lisan the regex misses.
// Never throws. On classifier error it returns false — the fast-path already guarantees the
// explicit cases, and the prompt grounding rule + output sanitizer backstop the rest.
export async function isPersonalRuling(message: string): Promise<RulingDetection> {
  const trimmed = message.trim();
  if (!trimmed) return { ruling: false, via: "none" };
  if (rulingKeywordHit(trimmed)) return { ruling: true, via: "keyword" };
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
            'If unsure, answer true. Reply with STRICT JSON {"ruling": true|false} and nothing else.',
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
  via: "keyword" | "classifier" | "none",
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
