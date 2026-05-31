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
    const isDateBoundary = /^\u200e?(?:\[\d{1,2}\/\d{1,2}\/\d{2,4},?\s|\d{1,2}\/\d{1,2}\/\d{2,4},?\s)/.test(line);

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

  const chunks = chunkContent(rawContent, 24000, transcriptType);

  const allEvents: ParsedEvent[] = [];
  const allNewMembers: ParsedNewMember[] = [];
  let groupName: string | null = null;
  let lastMessageAt: string | null = null;
  let systemPrompt = buildTranscriptSystemPrompt(flexiblePrompt, transcriptType);

  if (existingContext) {
    systemPrompt += `\n\n## Existing Items in Department
Reference these when detecting updates to existing milestones, tasks, or issues. If the transcript is about one of these existing records, classify it as the matching *_updated, *_completed, or *_resolved event instead of *_created. Use *_created only for genuinely new work not already represented below. Do not invent events from this context alone.
${existingContext}`;
  }

  let client: ReturnType<typeof getAIClient>;
  try {
    client = getAIClient();
  } catch (err) {
    console.warn("OpenAI client unavailable for transcript parsing; using deterministic fallback.", err);
    return parseTranscriptHeuristically(rawContent);
  }

  for (const chunk of chunks) {
    try {
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
    } catch (err) {
      console.error("Failed to parse OpenAI response for transcript chunk", err);
    }
  }

  const fallback = parseTranscriptHeuristically(rawContent);

  if (allEvents.length === 0) {
    return {
      group_name: groupName ?? fallback.group_name,
      last_message_at: lastMessageAt ?? fallback.last_message_at,
      events: fallback.events,
      new_members: dedupeNewMembers([...allNewMembers, ...fallback.new_members]),
    };
  }

  return {
    group_name: groupName ?? fallback.group_name,
    last_message_at: lastMessageAt ?? fallback.last_message_at,
    events: mergeParsedEvents(allEvents, fallback.events),
    new_members: dedupeNewMembers([...allNewMembers, ...fallback.new_members]),
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

function mergeParsedEvents(primaryEvents: ParsedEvent[], fallbackEvents: ParsedEvent[]) {
  const seen = new Set<string>();
  const merged: ParsedEvent[] = [];

  for (const event of [...primaryEvents, ...fallbackEvents]) {
    const key = eventKey(event);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(event);
  }

  return merged.slice(0, 80);
}

function eventKey(event: ParsedEvent) {
  const title = event.message_text || event.milestone_title || event.task_title || event.ai_summary || "";
  return [
    event.item_type,
    title.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80),
  ].join(":");
}

type TranscriptMessage = {
  sender: string;
  timestamp: string | null;
  text: string;
};

export function parseTranscriptHeuristically(rawContent: string): ParsedTranscript {
  const messages = parseMessages(rawContent);
  const events: ParsedEvent[] = [];
  const newMembers: ParsedNewMember[] = [];
  const groupName = inferGroupName(rawContent);

  for (const message of messages) {
    const addedMember = extractAddedMember(message.text);
    if (addedMember) {
      newMembers.push({
        alias: addedMember,
        context: `${message.sender} added ${addedMember}`,
      });
      continue;
    }

    if (isIgnorableMessage(message.text)) continue;

    const event = classifyMessage(message);
    if (event) events.push(event);
  }

  return {
    group_name: groupName,
    last_message_at: messages.at(-1)?.timestamp ?? null,
    events: events.slice(0, 40),
    new_members: dedupeNewMembers(newMembers),
  };
}

function parseMessages(rawContent: string): TranscriptMessage[] {
  const messages: TranscriptMessage[] = [];
  let current: TranscriptMessage | null = null;

  for (const rawLine of rawContent.split("\n")) {
    const line = stripInvisible(rawLine).trim();
    if (!line) continue;

    const parsedLine = parseMessageLine(line);
    if (parsedLine) {
      if (current) messages.push(current);
      current = parsedLine;
    } else if (current) {
      current.text = `${current.text}\n${line}`.trim();
    }
  }

  if (current) messages.push(current);
  return messages;
}

function parseMessageLine(line: string): TranscriptMessage | null {
  const bracketed = line.match(/^\[(\d{1,2}\/\d{1,2}\/\d{2,4}),\s+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM))\]\s+([^:]+):\s*(.*)$/i);
  if (bracketed) {
    return {
      timestamp: parseExportTimestamp(bracketed[1], bracketed[2]),
      sender: bracketed[3].trim(),
      text: bracketed[4].trim(),
    };
  }

  const dashed = line.match(/^(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)\s+-\s+([^:]+):\s*(.*)$/i);
  if (dashed) {
    return {
      timestamp: parseExportTimestamp(dashed[1], dashed[2]),
      sender: dashed[3].trim(),
      text: dashed[4].trim(),
    };
  }

  return null;
}

function classifyMessage(message: TranscriptMessage): ParsedEvent | null {
  const text = normalizeMessageText(message.text);
  const lower = text.toLowerCase();
  const issue = /(database error|bug|blocked|blocker|problem|issue|not working|can't|cannot|frustrated|overwhelmed|need to fix|fix login|not guaranteed)/.test(lower);
  const milestone = /(meeting|prototype|go live|website live|coming soon|password protected|launch|daily update|cross pms meeting|project management reporting|pmo coordination)/.test(lower);
  const actionable = issue || milestone || /(can you|can we|please|need to|needs to|work on|take this|create|add|update|provide|send|review|post|publish|set up|setup|build|integrate|fix|disable|make it|crawl|spread the word|inform others|let'?s meet|lets plan|schedule)/.test(lower);

  if (!actionable) return null;

  const itemType = issue ? "issue" : milestone ? "milestone" : "task";
  const completion = /(done|completed|resolved|works for me|looks good|sounds good|yep|sure)/.test(lower);
  const eventType = itemType === "milestone"
    ? "milestone_created"
    : itemType === "issue"
      ? completion ? "issue_resolved" : "issue_created"
      : completion ? "task_updated" : "task_created";

  return normalizeEvent({
    event_type: eventType,
    item_type: itemType,
    sender_alias: message.sender,
    message_timestamp: message.timestamp,
    message_text: text,
    ai_summary: titleFromText(text),
    task_title: itemType === "milestone" ? null : titleFromText(text),
    milestone_title: itemType === "milestone" ? titleFromText(text) : null,
    assigned_to_alias: inferAssignedAlias(message.sender, message.text),
    priority: inferPriority(text, itemType),
    confidence: 0.62,
    percent_complete: completion ? 100 : null,
    budget: null,
    notes: null,
    description: text,
  });
}

function inferGroupName(rawContent: string): string | null {
  const firstLine = stripInvisible(rawContent.split("\n")[0] ?? "");
  const systemMatch = firstLine.match(/^\[[^\]]+\]\s+(.+?):\s+Messages and calls are end-to-end encrypted/i);
  if (systemMatch) return systemMatch[1].trim();
  return null;
}

function extractAddedMember(text: string): string | null {
  const normalized = normalizeMessageText(text);
  const match = normalized.match(/\badded\s+(.+)$/i);
  if (!match || /added you to a group/i.test(normalized)) return null;
  return match[1].replace(/\s+to\s+.+$/i, "").trim() || null;
}

function isIgnorableMessage(text: string): boolean {
  const normalized = normalizeMessageText(text).toLowerCase();
  return (
    !normalized ||
    normalized.includes("messages and calls are end-to-end encrypted") ||
    normalized.includes("audio omitted") ||
    normalized.includes("image omitted") ||
    normalized.includes("document omitted") ||
    normalized.includes("this message was deleted") ||
    /^welcome\b/.test(normalized) ||
    /created this group/.test(normalized)
  );
}

function inferAssignedAlias(sender: string, rawText: string): string | null {
  const mentionMatches = Array.from(rawText.matchAll(/@⁨([^⁩]+)⁩/g)).map((match) => match[1].trim());
  const lower = normalizeMessageText(rawText).toLowerCase();

  if (mentionMatches.length > 0 && /(can you|please|work with|provide|review|come|take on|help)/.test(lower)) {
    return mentionMatches.at(-1) ?? null;
  }

  const directName = normalizeMessageText(rawText).match(/^([A-Z][A-Za-z]+),\s+can you\b/);
  if (directName) return directName[1];

  if (/^(sure|yep|yes|i can|i'll|ill|i will|let me)\b/i.test(normalizeMessageText(rawText))) {
    return sender;
  }

  return null;
}

function inferPriority(text: string, itemType: "task" | "issue" | "milestone"): "low" | "medium" | "high" {
  const lower = text.toLowerCase();
  if (itemType === "issue" || /(public|vazarat|password protected|database error|helpline|utaro|accommodation|not guaranteed)/.test(lower)) {
    return "high";
  }
  if (/(suggestion|nice to have|things to do|halal food)/.test(lower)) return "low";
  return "medium";
}

function titleFromText(text: string): string {
  const cleaned = text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/@[^@]+?(?=\s@|$)/g, "")
    .replace(/\s+/g, " ")
    .replace(/^(raja,\s*)?(can we|can you|please|need to|needs to|let'?s|lets|i can|i will|i'll|ill)\s+/i, "")
    .trim();

  const title = cleaned || text.trim();
  return title.length > 110 ? `${title.slice(0, 107).trim()}...` : title;
}

function normalizeMessageText(text: string): string {
  return stripInvisible(text)
    .replace(/<This message was edited>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripInvisible(value: string): string {
  return value.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "");
}

function parseExportTimestamp(datePart: string | undefined, timePart: string | undefined): string | null {
  if (!datePart || !timePart) return null;

  const [monthRaw, dayRaw, yearRaw] = datePart.split("/").map((part) => Number(part));
  const timeMatch = timePart.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!monthRaw || !dayRaw || !yearRaw || !timeMatch) return null;

  let hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const second = Number(timeMatch[3] ?? "0");
  const meridiem = timeMatch[4]?.toUpperCase();
  if (meridiem === "PM" && hour < 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;

  const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
  const date = new Date(Date.UTC(year, monthRaw - 1, dayRaw, hour, minute, second));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
