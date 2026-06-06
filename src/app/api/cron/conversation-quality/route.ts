import { NextRequest, NextResponse } from "next/server";

import { loadPromptByKey } from "@/lib/agent/prompts";
import { getAIClient, AI_MODEL, SUMMARY_TEMPERATURE, MAX_SUMMARY_TOKENS } from "@/lib/ai/model";
import { requireEnv } from "@/lib/env";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 120;

const BATCH_SIZE = 10;
const MAX_MESSAGES_PER_CONVERSATION = 30;

type SessionRow = {
  id: string;
  phone_e164: string;
  quality_analyzed_at: string | null;
  quality_message_count: number;
  last_message_at: string;
};

type MessageRow = {
  phone_e164: string;
  direction: "inbound" | "outbound";
  body: string | null;
  created_at: string;
};

type QualityResult = {
  conversation_id: string;
  score: "good" | "poor";
  reason?: string;
};

function isAuthorized(req: NextRequest): boolean {
  const authHeader = req.headers.get("authorization");
  const cronSecret = requireEnv("CRON_SECRET");
  if (authHeader === `Bearer ${cronSecret}`) return true;

  const adminKey = req.headers.get("x-admin-key") || req.nextUrl.searchParams.get("key");
  const expectedAdminKey = process.env.ADMIN_API_KEY;
  return Boolean(adminKey && expectedAdminKey && adminKey === expectedAdminKey);
}

export async function GET(req: NextRequest) {
  return run(req);
}

export async function POST(req: NextRequest) {
  return run(req);
}

async function run(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();

  const { data: logEntry } = await supabase
    .from("cron_job_logs")
    .insert({ job_key: "conversation_quality", status: "running" })
    .select("id")
    .single();
  const logId = logEntry?.id;

  try {
    const { data: sessions } = await supabase
      .from("conversation_sessions")
      .select("id, phone_e164, quality_analyzed_at, quality_message_count, last_message_at")
      .order("last_message_at", { ascending: false })
      .limit(200);

    if (!sessions || sessions.length === 0) {
      await completeLog(supabase, logId, "success", { conversations_analyzed: 0 });
      return NextResponse.json({ analyzed: 0, message: "No conversations to analyze" });
    }

    const phoneNumbers = (sessions as SessionRow[]).map((s) => s.phone_e164);

    const { data: allMessages } = await supabase
      .from("messages")
      .select("phone_e164, direction, body, created_at")
      .in("phone_e164", phoneNumbers)
      .order("created_at", { ascending: true });

    const messagesByPhone = new Map<string, MessageRow[]>();
    for (const msg of (allMessages ?? []) as MessageRow[]) {
      const existing = messagesByPhone.get(msg.phone_e164) ?? [];
      existing.push(msg);
      messagesByPhone.set(msg.phone_e164, existing);
    }

    const needsAnalysis: Array<{ session: SessionRow; messages: MessageRow[] }> = [];
    for (const session of sessions as SessionRow[]) {
      const msgs = messagesByPhone.get(session.phone_e164) ?? [];
      if (msgs.length < 2) continue;

      const hasNewMessages =
        !session.quality_analyzed_at ||
        msgs.length !== session.quality_message_count;

      if (hasNewMessages) {
        needsAnalysis.push({ session, messages: msgs });
      }
    }

    if (needsAnalysis.length === 0) {
      await completeLog(supabase, logId, "success", { conversations_analyzed: 0, skipped: sessions.length });
      return NextResponse.json({ analyzed: 0, message: "All conversations already analyzed" });
    }

    const qualityPrompt = await loadPromptByKey("conversation_quality");
    const client = getAIClient();

    let totalGood = 0;
    let totalPoor = 0;

    for (let i = 0; i < needsAnalysis.length; i += BATCH_SIZE) {
      const batch = needsAnalysis.slice(i, i + BATCH_SIZE);
      const conversationTexts = batch.map(({ session, messages }) => {
        const relevantMessages = messages.slice(-MAX_MESSAGES_PER_CONVERSATION);
        const lines = relevantMessages
          .filter((m) => m.body)
          .map((m) => `[${m.direction === "inbound" ? "USER" : "BOT"}] ${m.body}`);
        return `--- Conversation ID: ${session.id} (${session.phone_e164}) ---\n${lines.join("\n")}`;
      });

      const userContent = conversationTexts.join("\n\n");

      try {
        const response = await client.chat.completions.create({
          model: AI_MODEL,
          messages: [
            { role: "system", content: qualityPrompt },
            { role: "user", content: userContent },
          ],
          temperature: SUMMARY_TEMPERATURE,
          max_tokens: MAX_SUMMARY_TOKENS,
          response_format: { type: "json_object" },
        });

        const content = response.choices[0]?.message?.content?.trim() ?? "";
        const parsed = JSON.parse(content) as { results?: QualityResult[] };

        if (Array.isArray(parsed.results)) {
          for (const result of parsed.results) {
            const match = batch.find((b) => b.session.id === result.conversation_id);
            if (!match) continue;

            const score = result.score === "poor" ? "poor" : "good";
            if (score === "good") totalGood++;
            else totalPoor++;

            await supabase
              .from("conversation_sessions")
              .update({
                quality_score: score,
                quality_reason: score === "poor" ? (result.reason ?? null) : null,
                quality_analyzed_at: new Date().toISOString(),
                quality_message_count: match.messages.length,
              })
              .eq("id", match.session.id);
          }
        }
      } catch (err) {
        console.error("Quality analysis batch failed:", err);
      }
    }

    const metadata = {
      conversations_analyzed: totalGood + totalPoor,
      good: totalGood,
      poor: totalPoor,
      skipped: sessions.length - needsAnalysis.length,
    };

    await completeLog(supabase, logId, "success", metadata);

    return NextResponse.json({
      analyzed: totalGood + totalPoor,
      good: totalGood,
      poor: totalPoor,
      skipped: sessions.length - needsAnalysis.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Conversation quality cron failed:", err);
    await completeLog(supabase, logId, "failure", {}, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function completeLog(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  logId: string | undefined,
  status: "success" | "failure",
  metadata: Record<string, unknown>,
  errorMessage?: string,
) {
  if (!logId) return;
  await supabase
    .from("cron_job_logs")
    .update({
      status,
      completed_at: new Date().toISOString(),
      metadata,
      error_message: errorMessage ?? null,
    })
    .eq("id", logId);
}
