import { AI_MODEL, getAIClient } from "@/lib/ai/model";
import { getSupabaseAdmin } from "@/lib/supabase/server";

// How far back to look and how much work to do in one run. Kept bounded so the
// manual button (and a future cron) finish within the route's time budget.
const DEFAULT_LOOKBACK_DAYS = 7;
const MAX_CONVERSATIONS = 30;
const MESSAGES_PER_CONVERSATION = 40;
const ANALYZE_BATCH = 5;

export type GapSuggestion = {
  question: string;
  answer: string;
  category: string | null;
  confidence: number;
};

export type AnalyzeResult = {
  scanned: number; // conversations examined
  proposed: number; // raw suggestions from the model
  created: number; // new pending rows after dedup
  skippedDuplicates: number;
};

type MessageRow = {
  direction: string;
  body: string | null;
  created_at: string;
  raw_payload: unknown;
};

function isManualReply(raw: unknown): boolean {
  return !!raw && typeof raw === "object" && (raw as { source?: unknown }).source === "manual_admin";
}

// Normalize a question into a stable key so the same gap isn't re-proposed.
function dedupKey(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

// Phones whose conversations show a knowledge gap in the window:
//  - the agent's FAQ lookup returned no_indexed_match, or
//  - a human had to step in with a manual reply.
async function findCandidatePhones(sinceIso: string): Promise<string[]> {
  const supabase = getSupabaseAdmin();
  const phones = new Set<string>();

  const { data: audit } = await supabase
    .from("tool_audit_logs")
    .select("phone_e164")
    .eq("tool_name", "get_site_content_faq")
    .like("result_summary", "%no_indexed_match%")
    .gte("created_at", sinceIso);
  for (const row of audit ?? []) {
    if (row.phone_e164) phones.add(row.phone_e164 as string);
  }

  const { data: manual } = await supabase
    .from("messages")
    .select("phone_e164, raw_payload")
    .eq("direction", "outbound")
    .gte("created_at", sinceIso);
  for (const row of manual ?? []) {
    if (row.phone_e164 && isManualReply(row.raw_payload)) phones.add(row.phone_e164 as string);
  }

  return [...phones].slice(0, MAX_CONVERSATIONS);
}

async function buildTranscript(phone: string): Promise<string> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("messages")
    .select("direction, body, created_at, raw_payload")
    .eq("phone_e164", phone)
    .order("created_at", { ascending: false })
    .limit(MESSAGES_PER_CONVERSATION);

  const rows = ((data ?? []) as MessageRow[]).reverse();
  return rows
    .map((m) => {
      const text = (m.body ?? "").trim();
      if (!text) return null;
      const speaker =
        m.direction === "inbound" ? "Visitor" : isManualReply(m.raw_payload) ? "Human team" : "AI assistant";
      return `${speaker}: ${text}`;
    })
    .filter(Boolean)
    .join("\n");
}

const ANALYZE_SYSTEM_PROMPT = `You review one WhatsApp conversation from an event support line (Ashara Mubarak 1448H, Chicago) and extract reusable FAQ entries the AI assistant should have known.

Only propose an entry when ALL of these hold:
- The visitor asked something the AI could not answer well, AND the conversation contains a real, correct answer — usually from the "Human team" messages, or clearly established facts.
- The answer is GENERAL and reusable for other visitors (not one person's private logistics).

Strictly:
- NEVER invent an answer. If there is no real answer in the conversation, do not propose an entry.
- Remove all personal data: names, ITS numbers, phone numbers, individual addresses, booking codes. Write the question and answer generically.
- Ignore greetings, thanks, small talk, and questions the AI already answered correctly.
- Keep each question short and natural ("Where can I do utaro / stay at a mumin's house?"). Keep each answer concise and factual.

Return JSON only: {"suggestions":[{"question":"...","answer":"...","category":"hotels|transport|registration|schedule|venue|food|general","confidence":0.0-1.0}]}. Return {"suggestions":[]} if nothing qualifies.`;

async function analyzeOne(phone: string): Promise<GapSuggestion[]> {
  const transcript = await buildTranscript(phone);
  if (!transcript || transcript.length < 20) return [];

  const client = getAIClient();
  const res = await client.chat.completions.create({
    model: AI_MODEL,
    messages: [
      { role: "system", content: ANALYZE_SYSTEM_PROMPT },
      { role: "user", content: `Conversation:\n${transcript}` },
    ],
    temperature: 0.1,
    max_tokens: 800,
    response_format: { type: "json_object" },
  });

  const content = res.choices[0]?.message?.content;
  if (!content) return [];

  try {
    const parsed = JSON.parse(content) as { suggestions?: unknown };
    const list = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
    const out: GapSuggestion[] = [];
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const s = item as Record<string, unknown>;
      const question = typeof s.question === "string" ? s.question.trim() : "";
      const answer = typeof s.answer === "string" ? s.answer.trim() : "";
      if (!question || !answer) continue;
      out.push({
        question,
        answer,
        category: typeof s.category === "string" ? s.category : null,
        confidence: typeof s.confidence === "number" ? Math.max(0, Math.min(1, s.confidence)) : 0.5,
      });
    }
    return out;
  } catch {
    return [];
  }
}

// Examine recent conversations, draft FAQ candidates from the gaps, and persist
// the new ones as pending suggestions for an admin to review.
export async function analyzeConversationGaps(opts?: { lookbackDays?: number }): Promise<AnalyzeResult> {
  const lookbackDays = opts?.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const sinceIso = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
  const supabase = getSupabaseAdmin();

  const phones = await findCandidatePhones(sinceIso);

  // Analyze in small concurrent batches to stay within the time budget.
  const perPhone: { phone: string; suggestions: GapSuggestion[] }[] = [];
  for (let i = 0; i < phones.length; i += ANALYZE_BATCH) {
    const batch = phones.slice(i, i + ANALYZE_BATCH);
    const results = await Promise.all(
      batch.map(async (phone) => ({ phone, suggestions: await analyzeOne(phone).catch(() => []) })),
    );
    perPhone.push(...results);
  }

  const proposed = perPhone.reduce((n, p) => n + p.suggestions.length, 0);

  // Skip anything already queued or already turned into knowledge.
  const { data: existing } = await supabase
    .from("knowledge_suggestions")
    .select("dedup_key")
    .in("status", ["pending", "approved"]);
  const seen = new Set((existing ?? []).map((r) => r.dedup_key as string));

  const rows: Record<string, unknown>[] = [];
  let skippedDuplicates = 0;
  for (const { phone, suggestions } of perPhone) {
    for (const s of suggestions) {
      const key = dedupKey(s.question);
      if (!key || seen.has(key)) {
        skippedDuplicates++;
        continue;
      }
      seen.add(key);
      rows.push({
        question: s.question,
        suggested_answer: s.answer,
        category: s.category,
        confidence: s.confidence,
        source_phone: phone,
        dedup_key: key,
        status: "pending",
      });
    }
  }

  let created = 0;
  if (rows.length > 0) {
    const { data, error } = await supabase.from("knowledge_suggestions").insert(rows).select("id");
    if (error) throw error;
    created = data?.length ?? 0;
  }

  return { scanned: phones.length, proposed, created, skippedDuplicates };
}
