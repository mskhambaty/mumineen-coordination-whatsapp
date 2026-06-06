import { NextRequest, NextResponse } from "next/server";

import { requireAdminKey } from "@/lib/api/auth";
import { AI_MODEL, chatParams, getAIClient, PARSE_TEMPERATURE } from "@/lib/ai/model";
import { recordKnowledgeGap } from "@/lib/knowledge/knowledge-gaps";
import { getRecentMessages, getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 300;

const ANALYZE_PROMPT = `You analyze a past WhatsApp conversation between an event help BOT and a USER for Ashara Mubaraka Chicago.
Identify ONLY cases where the USER asked an INFORMATIONAL question and the BOT could NOT provide the information — it said the info isn't available/not published, deflected, or otherwise failed to answer a factual question.
IGNORE: greetings, thanks, chit-chat, questions the bot answered, emergencies, accommodation/utaro form requests, and personal/account-specific requests.
Return STRICT JSON only: {"gaps":[{"topic":"<short reusable topic, e.g. 'Markaz parking'>","question":"<the user's question, brief>"}]}. Use {"gaps":[]} if none. At most 3.`;

type Gap = { topic?: unknown; question?: unknown };

// POST /api/admin/knowledge-gaps/backfill?limit=60 — one-time pass over past conversations to
// flag topics the bot couldn't answer (the live agent handles this going forward).
export async function POST(req: NextRequest) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit") ?? 60), 1), 200);
  const supabase = getSupabaseAdmin();

  const { data: sessions, error } = await supabase
    .from("conversation_sessions")
    .select("phone_e164")
    .order("last_message_at", { ascending: false })
    .limit(limit);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const client = getAIClient();
  let scanned = 0;
  let withGaps = 0;
  let recorded = 0;

  for (const s of (sessions ?? []) as { phone_e164: string }[]) {
    const turns = await getRecentMessages(s.phone_e164, 30);
    if (!turns.some((t) => t.direction === "inbound" && t.body?.trim())) continue;
    scanned += 1;
    const transcript = turns
      .map((t) => `${t.direction === "inbound" ? "USER" : "BOT"}: ${(t.body ?? "").trim()}`)
      .filter((l) => l.length > 6)
      .join("\n")
      .slice(0, 6000);
    if (!transcript) continue;

    try {
      const res = await client.chat.completions.create({
        ...chatParams(AI_MODEL, { maxTokens: 400, temperature: PARSE_TEMPERATURE }),
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: ANALYZE_PROMPT },
          { role: "user", content: transcript },
        ],
      });
      const parsed = JSON.parse(res.choices[0]?.message?.content ?? "{}") as { gaps?: Gap[] };
      const gaps = Array.isArray(parsed.gaps) ? parsed.gaps : [];
      let any = false;
      for (const g of gaps.slice(0, 3)) {
        const topic = typeof g.topic === "string" ? g.topic.trim() : "";
        if (!topic) continue;
        const result = await recordKnowledgeGap(topic, typeof g.question === "string" ? g.question : null, s.phone_e164);
        if (result.status === "logged") {
          recorded += 1;
          any = true;
        }
      }
      if (any) withGaps += 1;
    } catch {
      // Skip a conversation that fails to analyze/parse; keep going.
    }
  }

  return NextResponse.json({ scanned, conversations_with_gaps: withGaps, gaps_recorded: recorded });
}
