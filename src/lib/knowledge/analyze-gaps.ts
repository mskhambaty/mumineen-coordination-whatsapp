import { AI_MODEL, getAIClient } from "@/lib/ai/model";
import { classifyToDepartments } from "@/lib/knowledge/faq-buckets";
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
  skippedDuplicates: number; // already queued/approved
  skippedAlreadyAnswered: number; // already covered in the department's FAQ bucket
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

  type Candidate = GapSuggestion & { phone: string; key: string };
  const candidates: Candidate[] = [];
  let skippedDuplicates = 0;
  for (const { phone, suggestions } of perPhone) {
    for (const s of suggestions) {
      const key = dedupKey(s.question);
      if (!key || seen.has(key)) {
        skippedDuplicates++;
        continue;
      }
      seen.add(key);
      candidates.push({ ...s, phone, key });
    }
  }

  if (candidates.length === 0) {
    return { scanned: phones.length, proposed, created: 0, skippedDuplicates, skippedAlreadyAnswered: 0 };
  }

  // Assign each candidate to a department, then drop ones already covered by that
  // department's FAQ bucket (duplicate / already-answered) so we only surface real gaps.
  const { data: deptRows } = await supabase.from("departments").select("id, name").order("name");
  const departments = (deptRows ?? []) as { id: string; name: string }[];
  const deptByName = new Map(departments.map((d) => [d.name.toLowerCase(), d]));

  const assignments = await classifyToDepartments(
    candidates.map((c) => c.question),
    departments.map((d) => d.name),
  ).catch(() => candidates.map(() => null));

  const withDept = candidates.map((c, i) => {
    const dept = assignments[i] ? deptByName.get(assignments[i]!.toLowerCase()) : undefined;
    return { ...c, departmentId: dept?.id ?? null, departmentName: dept?.name ?? null };
  });

  // Group by department and dedupe each group against that department's existing bucket.
  const byDept = new Map<string, typeof withDept>();
  for (const c of withDept) {
    const k = c.departmentId ?? "__none__";
    (byDept.get(k) ?? byDept.set(k, []).get(k)!).push(c);
  }

  let skippedAlreadyAnswered = 0;
  const kept: typeof withDept = [];
  for (const [deptId, group] of byDept) {
    if (deptId === "__none__") {
      kept.push(...group);
      continue;
    }
    const { data: bucket } = await supabase
      .from("faq_buckets")
      .select("content")
      .eq("department_id", deptId)
      .maybeSingle();
    const content = ((bucket?.content as string) ?? "").trim();
    if (!content) {
      kept.push(...group); // nothing to compare against yet
      continue;
    }
    const keepFlags = await filterAgainstBucket(content, group.map((g) => ({ question: g.question, answer: g.answer })));
    group.forEach((g, i) => {
      if (keepFlags[i]) kept.push(g);
      else skippedAlreadyAnswered++;
    });
  }

  let created = 0;
  if (kept.length > 0) {
    const rows = kept.map((c) => ({
      question: c.question,
      suggested_answer: c.answer,
      category: c.category,
      confidence: c.confidence,
      source_phone: c.phone,
      dedup_key: c.key,
      department_id: c.departmentId,
      status: "pending",
    }));
    const { data, error } = await supabase.from("knowledge_suggestions").insert(rows).select("id");
    if (error) throw error;
    created = data?.length ?? 0;
  }

  return { scanned: phones.length, proposed, created, skippedDuplicates, skippedAlreadyAnswered };
}

// Ask the model which candidate Q&As are genuinely NEW vs. already covered (duplicate or
// already-answered, even if worded differently) by the department's existing FAQ text.
async function filterAgainstBucket(
  bucketContent: string,
  candidates: { question: string; answer: string }[],
): Promise<boolean[]> {
  if (candidates.length === 0) return [];
  const client = getAIClient();
  try {
    const res = await client.chat.completions.create({
      model: AI_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You decide which candidate FAQ entries are genuinely NEW versus already covered by an existing FAQ. " +
            "A candidate is NOT new if the existing FAQ already answers the same question (even if worded differently). " +
            "Return JSON {\"new\":[<indices of genuinely new candidates>]}.",
        },
        {
          role: "user",
          content:
            `EXISTING FAQ for this department:\n${bucketContent}\n\nCANDIDATES:\n` +
            candidates.map((c, i) => `${i}. Q: ${c.question}\n   A: ${c.answer}`).join("\n"),
        },
      ],
      temperature: 0,
      max_tokens: 500,
      response_format: { type: "json_object" },
    });
    const parsed = JSON.parse(res.choices[0]?.message?.content ?? "{}") as { new?: number[] };
    const newSet = new Set(Array.isArray(parsed.new) ? parsed.new : []);
    return candidates.map((_, i) => newSet.has(i));
  } catch {
    // On failure, keep everything rather than silently dropping real gaps.
    return candidates.map(() => true);
  }
}
