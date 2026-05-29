import OpenAI from "openai";

import { requireEnv, optionalEnv } from "@/lib/env";

export type ParsedEvent = {
  event_type: "task_created" | "task_updated" | "task_completed" | "decision" | "info";
  sender_alias: string | null;
  message_timestamp: string | null;
  message_text: string | null;
  ai_summary: string | null;
  task_title: string | null;
  assigned_to_alias: string | null;
  confidence: number;
};

export type ParsedTranscript = {
  group_name: string | null;
  last_message_at: string | null;
  events: ParsedEvent[];
};

const PARSER_SYSTEM_PROMPT = `You are a project status extraction assistant for Anjuman e Saifee Chicago Ashara Mubarak 1448H coordination.

Extract actionable project management events from the WhatsApp group conversation below.

For each actionable item found, return a JSON object in this exact structure:
{
  "event_type": "task_created" | "task_updated" | "task_completed" | "decision" | "info",
  "sender_alias": "<name as it appears in the transcript>",
  "message_timestamp": "<ISO 8601 datetime if parseable, else null>",
  "message_text": "<the original message verbatim>",
  "ai_summary": "<one sentence summary of what this means for the project>",
  "task_title": "<short task title if this creates or updates a task, else null>",
  "assigned_to_alias": "<name of person assigned if mentioned, else null>",
  "confidence": <0.0 to 1.0 — how confident you are this is truly actionable>
}

Only include items with confidence >= 0.5.
Return a JSON object: { "group_name": "<from first line if parseable>", "last_message_at": "<ISO datetime of last message>", "events": [...] }
Do not include media omission lines or system messages as events.`;

let openaiClient: OpenAI | null = null;

function getClient(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: requireEnv("OPENAI_API_KEY") });
  }
  return openaiClient;
}

function chunkContent(content: string, maxChars: number = 24000): string[] {
  if (content.length <= maxChars) return [content];

  const lines = content.split("\n");
  const chunks: string[] = [];
  let current = "";

  for (const line of lines) {
    // Split on date boundaries (common WhatsApp format: MM/DD/YY or DD/MM/YY)
    const isDateBoundary = /^\d{1,2}\/\d{1,2}\/\d{2,4},?\s/.test(line);

    if (isDateBoundary && current.length > maxChars * 0.7) {
      chunks.push(current);
      current = line + "\n";
    } else {
      current += line + "\n";
    }
  }

  if (current.trim()) {
    chunks.push(current);
  }

  return chunks;
}

export async function parseTranscript(rawContent: string): Promise<ParsedTranscript> {
  const client = getClient();
  const model = optionalEnv("OPENAI_MODEL") || "gpt-4.1-mini";
  const chunks = chunkContent(rawContent);

  const allEvents: ParsedEvent[] = [];
  let groupName: string | null = null;
  let lastMessageAt: string | null = null;

  for (const chunk of chunks) {
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: PARSER_SYSTEM_PROMPT },
        { role: "user", content: chunk },
      ],
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) continue;

    try {
      const parsed = JSON.parse(content) as ParsedTranscript;
      if (parsed.group_name && !groupName) {
        groupName = parsed.group_name;
      }
      if (parsed.last_message_at) {
        lastMessageAt = parsed.last_message_at;
      }
      if (parsed.events) {
        allEvents.push(...parsed.events.filter((e) => e.confidence >= 0.5));
      }
    } catch {
      console.error("Failed to parse OpenAI response for transcript chunk");
    }
  }

  return {
    group_name: groupName,
    last_message_at: lastMessageAt,
    events: allEvents,
  };
}
