export const FIXED_TRANSCRIPT_PROMPT = `You are a project status extraction assistant for Anjuman e Saifee Chicago Ashara Mubarak 1448H.
Extract actionable project management events from the WhatsApp group conversation.
Return ONLY valid JSON in the exact schema specified. Do not include markdown or explanation.
Schema: { group_name, last_message_at, events: [{ event_type, sender_alias, message_timestamp, message_text, ai_summary, task_title, assigned_to_alias, priority, confidence }], new_members: [{ alias, context }] }
event_type must be one of: task_created | task_updated | task_completed | decision | info
priority must be one of: low | medium | high
Only include events with confidence >= 0.5.`;

const defaultPrompt =
  "Focus on action items, assignments, deadlines, and status updates. Flag any blockers explicitly. If someone says 'I will' or 'can you', treat as task_created. If someone confirms completion, treat as task_completed.";

const departmentRules: Record<string, string> = {
  site: "Pay special attention to vendor confirmations, delivery dates, equipment rentals, and safety inspections.",
  construction: "Pay special attention to vendor confirmations, delivery dates, equipment rentals, and safety inspections.",
  mawaid: "Focus on food counts, vendor confirmations, timing, and volunteer assignments.",
  transport: "Focus on driver assignments, vehicle counts, timing, and pickup/dropoff logistics.",
  medical: "Flag any medical supply needs or staffing gaps as high priority.",
  "flow management": "Focus on crowd management assignments, checkpoint staffing, and capacity numbers.",
};

export function getDefaultFlexiblePrompt(departmentName?: string | null): string {
  const normalized = departmentName?.trim().toLowerCase() ?? "";
  const matchingRule = Object.entries(departmentRules).find(([key]) => normalized.includes(key))?.[1];

  return matchingRule ? `${defaultPrompt} ${matchingRule}` : defaultPrompt;
}

export function buildTranscriptSystemPrompt(flexiblePrompt?: string | null): string {
  const trimmedFlexiblePrompt = flexiblePrompt?.trim();
  if (!trimmedFlexiblePrompt) {
    return FIXED_TRANSCRIPT_PROMPT;
  }

  return `${FIXED_TRANSCRIPT_PROMPT}

Department-specific extraction rules:
${trimmedFlexiblePrompt}`;
}
