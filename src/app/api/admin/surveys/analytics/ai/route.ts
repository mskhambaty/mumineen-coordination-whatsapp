import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { AI_MODEL, MAX_SUMMARY_TOKENS, SUMMARY_TEMPERATURE, chatParams, getAIClient } from "@/lib/ai/model";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/admin/surveys/analytics/ai — AI qualitative analysis of the (already-filtered) free-text
// and negative-reason comments: overall sentiment, recurring themes, and actionable areas of
// improvement. The caller passes the comment texts it's already showing (from the analytics
// endpoint), so this never re-queries or widens scope. Only comment TEXT is sent to the model — no
// names, phones, or ITS numbers.
const bodySchema = z.object({
  comments: z.array(z.object({ text: z.string().min(1), area: z.string().nullable().optional() })).min(1).max(600),
  scope: z.string().max(300).optional(), // human label of the active filter, for context only
});

const SYSTEM = `You analyze open-text feedback from attendees of Ashara Mubaraka, a large multi-day
religious gathering (waaz/sermons, mawaid/communal meals, seating, audio-video relay, transport &
parking, accommodation, accessibility/rahat, childcare). You are given anonymized comments (no
identities). Produce a clear, decision-useful analysis for the organizing committee.

Return ONLY valid JSON with this exact shape:
{
  "overall_sentiment": "positive" | "mixed" | "negative",
  "sentiment_score_1_5": number,            // 1=very negative, 5=very positive
  "summary": string,                         // 2-3 sentences
  "themes": [                                // most significant recurring topics, max 8
    { "theme": string, "sentiment": "positive"|"mixed"|"negative", "mentions": number, "example": string }
  ],
  "improvements": [                          // concrete, actionable, ranked by impact, max 8
    { "area": string, "suggestion": string, "severity": "low"|"medium"|"high" }
  ],
  "positives": [string]                      // what attendees appreciated, max 6
}
Base everything strictly on the supplied comments — do not invent specifics. "example" must be a
short quote drawn from the comments.`;

export async function POST(req: NextRequest) {
  const guard = await requirePortalCaller(req, isAdminOrLeadership);
  if (guard instanceof NextResponse) return guard;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  const { comments, scope } = parsed.data;

  // Bound the prompt: cap and lightly format. Truncate over-long single comments.
  const lines = comments.slice(0, 600).map((c, i) => `${i + 1}. ${c.area ? `[${c.area}] ` : ""}${c.text.slice(0, 400)}`);
  const truncatedNote = comments.length > 600 ? ` (showing first 600 of ${comments.length})` : "";

  let raw: string;
  try {
    const completion = await getAIClient().chat.completions.create({
      ...chatParams(AI_MODEL, { maxTokens: MAX_SUMMARY_TOKENS, temperature: SUMMARY_TEMPERATURE }),
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `${scope ? `Filter scope: ${scope}\n` : ""}Comments${truncatedNote}:\n${lines.join("\n")}` },
      ],
    });
    raw = completion.choices[0]?.message?.content ?? "";
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "AI analysis failed." }, { status: 502 });
  }

  let analysis: unknown;
  try {
    analysis = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "AI returned an unparseable response." }, { status: 502 });
  }
  return NextResponse.json({ analysis, analyzed: Math.min(comments.length, 600) });
}
