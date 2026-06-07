import { AI_MODEL_HIGH, MAX_SUMMARY_TOKENS, SUMMARY_TEMPERATURE, chatParams, getAIClient } from "@/lib/ai/model";
import { getDepartmentCatalog, renderCatalog, type Dept } from "@/lib/departments/classify";
import { FEEDBACK_AREAS, normalizeArea } from "@/lib/feedback/areas";
import { getSupabaseAdmin } from "@/lib/supabase/server";

// Nightly batch: mine the last 24h of raw WhatsApp conversations for experience feedback that the
// agent's real-time submit_feedback tool didn't capture, and write it to feedback_entries so the
// digest can raise it with the right department. This is BATCHED (many conversations per LLM call,
// a handful of calls per night) — so it uses the higher-end OPENAI_MODEL_HIGH preset rather than
// looping the cheap model per conversation.

const CONVERSATIONS_PER_CHUNK = 12; // packed into one LLM call
const MAX_CHUNKS = 30; // safety cap (~360 conversations/night)
const MAX_MSGS_PER_CONVO = 24;
const MAX_BODY_CHARS = 320;
const WINDOW_MS = 24 * 60 * 60 * 1000;

type Msg = { phone_e164: string; direction: "inbound" | "outbound"; body: string | null; created_at: string };

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function stripFences(s: string): string {
  return s.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
}

// Group the window's messages into per-phone transcripts, newest conversations first.
function buildTranscripts(messages: Msg[]): { phone: string; transcript: string }[] {
  const byPhone = new Map<string, Msg[]>();
  for (const m of messages) {
    const list = byPhone.get(m.phone_e164) ?? [];
    list.push(m);
    byPhone.set(m.phone_e164, list);
  }
  const convos: { phone: string; transcript: string; last: number }[] = [];
  for (const [phone, msgs] of byPhone) {
    const hasInbound = msgs.some((m) => m.direction === "inbound" && (m.body ?? "").trim());
    if (!hasInbound) continue;
    const tail = msgs.slice(-MAX_MSGS_PER_CONVO);
    const transcript = tail
      .map((m) => `${m.direction === "inbound" ? "U" : "A"}: ${(m.body ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_BODY_CHARS)}`)
      .filter((l) => l.length > 3)
      .join("\n");
    if (transcript.length < 12) continue;
    convos.push({ phone, transcript, last: new Date(tail[tail.length - 1].created_at).getTime() });
  }
  return convos.sort((a, b) => b.last - a.last).map(({ phone, transcript }) => ({ phone, transcript }));
}

type Extracted = { summary: string; sentiment: "positive" | "neutral" | "negative" | null; department_index: number; area: string };

const SYSTEM =
  "You mine WhatsApp conversations from a Dawoodi Bohra Ashara relay center for concrete EXPERIENCE " +
  "FEEDBACK — complaints, praise, or actionable observations about the on-ground experience (mawaid/food, " +
  "flow/crowd, parking/transport, audio-video, accommodation, seating, cleanliness, facilities, etc.). " +
  "IGNORE pure information questions, greetings, duas, registration/visa queries, and small talk. " +
  "Route each item to ONE department from the catalog using its name + description. " +
  'Reply with STRICT JSON: {"items":[{"summary": string, "sentiment": "positive"|"neutral"|"negative", "department_index": number, "area": string}]}. ' +
  "summary = one neutral sentence, no names or phone numbers. department_index = catalog number (0 if none fits). " +
  "area = one of: mawaid, flow, parking_transport, audio_video, accommodation, seating, general. Return an empty items array if there is no real feedback.";

async function extractFromChunk(convos: { phone: string; transcript: string }[], depts: Dept[]): Promise<Extracted[]> {
  const catalog = renderCatalog(depts);
  const body = convos.map((c, i) => `--- Conversation ${i + 1} ---\n${c.transcript}`).join("\n\n");
  try {
    const client = getAIClient();
    const res = await client.chat.completions.create({
      ...chatParams(AI_MODEL_HIGH, { maxTokens: MAX_SUMMARY_TOKENS, temperature: SUMMARY_TEMPERATURE }),
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Departments:\n${catalog}\n\nConversations:\n${body}` },
      ],
    });
    const raw = stripFences(res.choices[0]?.message?.content?.trim() ?? "");
    const parsed = JSON.parse(raw) as { items?: unknown };
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    return items
      .map((it) => it as Record<string, unknown>)
      .filter((it) => typeof it.summary === "string" && (it.summary as string).trim())
      .map((it) => ({
        summary: (it.summary as string).trim().slice(0, 600),
        sentiment: ["positive", "neutral", "negative"].includes(it.sentiment as string) ? (it.sentiment as Extracted["sentiment"]) : null,
        department_index: Number.isFinite(Number(it.department_index)) ? Number(it.department_index) : 0,
        area: typeof it.area === "string" ? (it.area as string) : "general",
      }));
  } catch (err) {
    console.error("Conversation-mining chunk failed:", err);
    return [];
  }
}

export type MineResult = { conversations: number; chunks: number; feedback: number };

// Mine the trailing 24h of conversations for the given digest date (Chicago) and insert mined
// feedback rows. Best-effort: returns counts; never throws.
export async function mineConversationsForFeedback(date: string): Promise<MineResult> {
  const supabase = getSupabaseAdmin();
  const since = new Date(Date.now() - WINDOW_MS).toISOString();

  const { data } = await supabase
    .from("messages")
    .select("phone_e164, direction, body, created_at")
    .gte("created_at", since)
    .order("phone_e164", { ascending: true })
    .order("created_at", { ascending: true });

  const messages = (data ?? []) as Msg[];
  const transcripts = buildTranscripts(messages);
  if (transcripts.length === 0) return { conversations: 0, chunks: 0, feedback: 0 };

  // Idempotent: clear any previously-mined rows for this date so a re-run doesn't duplicate.
  await supabase.from("feedback_entries").delete().eq("source", "mined").eq("event_date", date);

  const depts = await getDepartmentCatalog();
  const chunks = chunk(transcripts, CONVERSATIONS_PER_CHUNK).slice(0, MAX_CHUNKS);

  const rows: Record<string, unknown>[] = [];
  for (const c of chunks) {
    const items = await extractFromChunk(c, depts);
    for (const it of items) {
      const area = (FEEDBACK_AREAS as readonly string[]).includes(it.area) ? it.area : normalizeArea(it.area);
      const departmentId = it.department_index >= 1 && it.department_index <= depts.length ? depts[it.department_index - 1].id : null;
      rows.push({
        family_id: null,
        mumin_id: null,
        phone_e164: null,
        area,
        department_id: departmentId,
        sentiment: it.sentiment,
        rating: null,
        comment_text: it.summary,
        raw_message: null,
        event_date: date,
        source: "mined",
      });
    }
  }

  if (rows.length > 0) {
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase.from("feedback_entries").insert(rows.slice(i, i + 500));
      if (error) console.error("Mined feedback insert failed:", error.message);
    }
  }

  return { conversations: transcripts.length, chunks: chunks.length, feedback: rows.length };
}
