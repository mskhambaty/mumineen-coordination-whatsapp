import { AI_MODEL, getAIClient, MAX_PARSE_TOKENS, PARSE_TEMPERATURE } from "@/lib/ai/model";
import { buildTranscriptSystemPrompt, type TranscriptType } from "@/lib/transcripts/prompts";

export type ParsedEvent = {
  event_type:
    | "task_created" | "task_updated" | "task_completed"
    | "milestone_created" | "milestone_updated"
    | "issue_created" | "issue_updated" | "issue_resolved"
    | "decision" | "info";
  item_type: "task" | "issue" | "milestone";
  sender_alias: string | null;
  message_timestamp: string | null;
  message_text: string | null;
  ai_summary: string | null;
  task_title: string | null;
  milestone_title: string | null;
  assigned_to_alias: string | null;
  priority: "low" | "medium" | "high";
  confidence: number;
  percent_complete: number | null;
  budget: number | null;
  notes: string | null;
  description: string | null;
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

function chunkWhatsApp(content: string, maxChars: number): string[] {
  if (content.length <= maxChars) return [content];

  const lines = content.split("\n");
  const chunks: string[] = [];
  let current = "";

  for (const line of lines) {
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

function chunkMeeting(content: string, maxChars: number): string[] {
  if (content.length <= maxChars) return [content];

  const paragraphs = content.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if (current.length + paragraph.length > maxChars * 0.9 && current.length > maxChars * 0.3) {
      chunks.push(current);
      current = paragraph + "\n\n";
    } else {
      current += paragraph + "\n\n";
    }
  }

  if (current.trim()) {
    chunks.push(current);
  }

  return chunks;
}

function chunkContent(content: string, maxChars: number = 24000, transcriptType: TranscriptType = "whatsapp"): string[] {
  return transcriptType === "meeting" ? chunkMeeting(content, maxChars) : chunkWhatsApp(content, maxChars);
}

type ParseOptions = {
  flexiblePrompt?: string | null;
  transcriptType?: TranscriptType;
  existingContext?: string | null;
};

export async function parseTranscript(rawContent: string, optsOrFlexiblePrompt?: ParseOptions | string | null): Promise<ParsedTranscript> {
  const opts: ParseOptions = typeof optsOrFlexiblePrompt === "string" || optsOrFlexiblePrompt === null || optsOrFlexiblePrompt === undefined
    ? { flexiblePrompt: optsOrFlexiblePrompt }
    : optsOrFlexiblePrompt;

  const { flexiblePrompt, transcriptType = "whatsapp", existingContext } = opts;

  const client = getAIClient();
  const chunks = chunkContent(rawContent, 24000, transcriptType);

  const allEvents: ParsedEvent[] = [];
  const allNewMembers: ParsedNewMember[] = [];
  let groupName: string | null = null;
  let lastMessageAt: string | null = null;
  let systemPrompt = buildTranscriptSystemPrompt(flexiblePrompt, transcriptType);

  if (existingContext) {
    systemPrompt += `\n\n## Existing Items in Department\nReference these when detecting updates to existing milestones, tasks, or issues:\n${existingContext}`;
  }

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
    item_type: event.item_type || inferItemType(event.event_type),
    priority: event.priority === "high" || event.priority === "low" ? event.priority : "medium",
    percent_complete: event.percent_complete ?? null,
    budget: event.budget ?? null,
    notes: event.notes ?? null,
    description: event.description ?? null,
    milestone_title: event.milestone_title ?? null,
  };
}

function inferItemType(eventType: string): "task" | "issue" | "milestone" {
  if (eventType.startsWith("milestone")) return "milestone";
  if (eventType.startsWith("issue")) return "issue";
  return "task";
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
