export type TranscriptType = "whatsapp" | "meeting";

export const FIXED_TRANSCRIPT_PROMPT = `You are a project status extraction assistant for Anjuman e Saifee Chicago Ashara Mubarak 1448H.
Extract actionable project management events from the WhatsApp group conversation.
Return ONLY valid JSON in the exact schema specified. Do not include markdown or explanation.
Schema: { group_name, last_message_at, events: [{ event_type, item_type, sender_alias, message_timestamp, message_text, ai_summary, task_title, milestone_title, assigned_to_alias, priority, confidence, percent_complete, budget, notes, description }], new_members: [{ alias, context }] }
event_type must be one of: task_created | task_updated | task_completed | milestone_created | milestone_updated | issue_created | issue_updated | issue_resolved | decision | info
item_type must be one of: task | issue | milestone
priority must be one of: low | medium | high
Only include events with confidence >= 0.5.

## Categorization Guide
- Milestones: Major deliverables, project phases, budget line items, deadlines for major event components. Include budget and percent_complete when mentioned.
- Tasks: Work items, action items, assignments, follow-ups that drive toward milestones. Use item_type "task".
- Issues: Blockers, problems, concerns, risks that need escalation or leadership attention. Use item_type "issue".`;

export const FIXED_MEETING_PROMPT = `You are a project status extraction assistant for Anjuman e Saifee Chicago Ashara Mubarak 1448H.
Extract actionable project management events from meeting transcript or minutes.
Return ONLY valid JSON in the exact schema specified. Do not include markdown or explanation.
Schema: { group_name, last_message_at, events: [{ event_type, item_type, sender_alias, message_timestamp, message_text, ai_summary, task_title, milestone_title, assigned_to_alias, priority, confidence, percent_complete, budget, notes, description }], new_members: [{ alias, context }] }
event_type must be one of: task_created | task_updated | task_completed | milestone_created | milestone_updated | issue_created | issue_updated | issue_resolved | decision | info
item_type must be one of: task | issue | milestone
priority must be one of: low | medium | high
Only include events with confidence >= 0.5.

## Meeting-Specific Rules
- Treat agenda items with assigned owners as task_created.
- Treat follow-up items and action items as task_created.
- Treat resolved or completed items as task_completed.
- Treat formal motions, resolutions, and major decisions as decision events.
- Treat budget approvals and milestone updates as milestone_updated.
- Treat raised concerns and blockers as issue_created.
- Attendees who were not previously known should appear in new_members.

## Categorization Guide
- Milestones: Major deliverables, project phases, budget line items, deadlines for major event components. Include budget and percent_complete when mentioned.
- Tasks: Work items, action items, assignments, follow-ups that drive toward milestones. Use item_type "task".
- Issues: Blockers, problems, concerns, risks that need escalation or leadership attention. Use item_type "issue".`;

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

export function getFixedPrompt(transcriptType: TranscriptType): string {
  return transcriptType === "meeting" ? FIXED_MEETING_PROMPT : FIXED_TRANSCRIPT_PROMPT;
}

export function buildTranscriptSystemPrompt(
  flexiblePrompt?: string | null,
  transcriptType: TranscriptType = "whatsapp",
): string {
  const fixedPrompt = getFixedPrompt(transcriptType);
  const trimmedFlexiblePrompt = flexiblePrompt?.trim();
  if (!trimmedFlexiblePrompt) {
    return fixedPrompt;
  }

  return `${fixedPrompt}

Department-specific extraction rules:
${trimmedFlexiblePrompt}`;
}
