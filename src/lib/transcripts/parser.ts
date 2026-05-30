import { AI_MODEL, getAIClient, MAX_PARSE_TOKENS, PARSE_TEMPERATURE } from "@/lib/ai/model";
import { buildTranscriptSystemPrompt } from "@/lib/transcripts/prompts";

export type ParsedEvent = {
  event_type: "task_created" | "task_updated" | "task_completed" | "decision" | "info";
  sender_alias: string | null;
  message_timestamp: string | null;
  message_text: string | null;
  ai_summary: string | null;
  task_title: string | null;
  assigned_to_alias: string | null;
  priority: "low" | "medium" | "high";
  confidence: number;
};

export type ParsedNewMember = {
  alias: string;
  context: string;
};

export type ParsedTranscript = {
  group_name: string | null;
  last_message_at: string | null;
  events: ParsedEvent[];
  new_members: ParsedNewMember[];
};

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

export async function parseTranscript(rawContent: string, flexiblePrompt?: string | null): Promise<ParsedTranscript> {
  const client = getAIClient();
  const chunks = chunkContent(rawContent);

  const allEvents: ParsedEvent[] = [];
  const allNewMembers: ParsedNewMember[] = [];
  let groupName: string | null = null;
  let lastMessageAt: string | null = null;
  const systemPrompt = buildTranscriptSystemPrompt(flexiblePrompt);

  for (const chunk of chunks) {
    const response = await client.chat.completions.create({
      model: AI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: chunk },
      ],
      response_format: { type: "json_object" },
      temperature: PARSE_TEMPERATURE,
      max_tokens: MAX_PARSE_TOKENS,
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
        allEvents.push(...parsed.events.filter((e) => e.confidence >= 0.5).map(normalizeEvent));
      }
      if (parsed.new_members) {
        allNewMembers.push(...parsed.new_members.filter(isValidNewMember));
      }
    } catch {
      console.error("Failed to parse OpenAI response for transcript chunk");
    }
  }

  return {
    group_name: groupName,
    last_message_at: lastMessageAt,
    events: allEvents,
    new_members: dedupeNewMembers(allNewMembers),
  };
}

function normalizeEvent(event: ParsedEvent): ParsedEvent {
  return {
    ...event,
    priority: event.priority === "high" || event.priority === "low" ? event.priority : "medium",
  };
}

function isValidNewMember(member: ParsedNewMember) {
  return Boolean(member.alias?.trim());
}

function dedupeNewMembers(members: ParsedNewMember[]) {
  const seen = new Set<string>();
  const deduped: ParsedNewMember[] = [];

  for (const member of members) {
    const key = member.alias.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({ alias: member.alias.trim(), context: member.context ?? "" });
  }

  return deduped;
}
