export type TranscriptType = "whatsapp" | "meeting";

const TRANSCRIPT_SCHEMA =
  "Schema: { group_name, last_message_at, events: [{ event_type, item_type, sender_alias, message_timestamp, message_text, ai_summary, task_title, milestone_title, assigned_to_alias, priority, confidence, percent_complete, budget, notes, description }], new_members: [{ alias, context }] }";

const COMMON_EXTRACTION_RULES = `## Categorization Guide
- Milestones: Major deliverables, project phases, budget line items, readiness checkpoints, large cross-team outcomes, or deadlines for major event components. Include budget and percent_complete when mentioned.
- Tasks: Concrete work items, assignments, follow-ups, reviews, coordination steps, content requests, vendor calls, and operational actions that drive milestones. Use item_type "task".
- Issues: Blockers, open decisions, risks, missing information, unclear ownership, capacity constraints, bugs/errors, policy restrictions, safety concerns, or dependencies that need escalation. Use item_type "issue".

## Coordination Language Rules
- Treat "can you", "please", "need to", "needs to", "work on", "provide", "send", "review", "post", "publish", "fix", "add", "update", "call", "confirm", and "let AV/vendor/team know" as task signals.
- Treat "can we", "should we", "do we have", "how do we", "how to go about it", "is this still", and other unresolved questions as issue signals when they block a decision or reveal missing information.
- Treat "sure", "yep", "sounds good", "I can", "I will", "I'll", and "let me" as acceptance/progress for nearby prior work, usually task_updated rather than a separate new task.
- Treat "done", "completed", "resolved", "works for me", "looks good", "published", "posted", "fixed", or equivalent confirmations as task_completed, issue_resolved, or milestone_updated.
- Extract an assigned_to_alias only when a person is explicitly mentioned, directly addressed, or clearly accepts ownership. Otherwise leave it null.
- Extract new_members from WhatsApp system messages like "X added Y" and from attendees/participants who appear to be new work owners.
- Do not create events for greetings, jokes, thanks, repeated context, audio/image/document omitted lines, pure links without an action, or general FYI messages that do not affect a milestone, task, issue, or member.
- Prefer fewer high-quality review proposals over noisy extraction. If uncertain but review-worthy, use confidence between 0.5 and 0.7.`;

export const FIXED_TRANSCRIPT_PROMPT = `You are a project status extraction assistant for Anjuman e Saifee Chicago Ashara Mubarak 1448H.
Extract actionable project management events from the WhatsApp group conversation.
Return ONLY valid JSON in the exact schema specified. Do not include markdown or explanation.
${TRANSCRIPT_SCHEMA}
event_type must be one of: task_created | task_updated | task_completed | milestone_created | milestone_updated | issue_created | issue_updated | issue_resolved | decision | info
item_type must be one of: task | issue | milestone
priority must be one of: low | medium | high
Only include events with confidence >= 0.5.

${COMMON_EXTRACTION_RULES}`;

export const FIXED_MEETING_PROMPT = `You are a project status extraction assistant for Anjuman e Saifee Chicago Ashara Mubarak 1448H.
Extract actionable project management events from meeting transcript or minutes.
Return ONLY valid JSON in the exact schema specified. Do not include markdown or explanation.
${TRANSCRIPT_SCHEMA}
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
- Use the meeting date as context for relative due dates like "tomorrow", "next week", or "before waaz" when summarizing.
- Preserve named owners and committees from action-item phrasing.

${COMMON_EXTRACTION_RULES}`;

const defaultPrompt =
  "Focus on reviewable milestones, tasks, issues, status updates, owners, deadlines, and new members. Convert unresolved operational questions into issues when they block progress. Convert accepted requests into task updates. Skip greetings, jokes, repeated context, omitted media, and pure FYI messages.";

const whatsappPromptSuffix =
  "For WhatsApp exports, infer ownership from mentions, direct replies, and short acknowledgements like sure/yep/I can. Treat message order as context, but do not invent owners when unclear.";

const meetingPromptSuffix =
  "For meeting transcripts, prioritize agenda decisions, action items, owners, due dates, risks, dependencies, and attendee/member additions. Treat follow-ups without owners as tasks with assigned_to_alias null.";

type DepartmentRule = {
  patterns: RegExp[];
  prompt: string;
};

const departmentRules: DepartmentRule[] = [
  {
    patterns: [/accommodation/],
    prompt: "Accommodation: Track utaro requests, hotel blocks, room counts, arrival/departure dependencies, form links, confirmation timing, negotiated rates, and guest communication. Flag uncertainty around accommodations or booking prerequisites as high-priority issues.",
  },
  {
    patterns: [/\bavr\b/, /audio/, /video/],
    prompt: "AVR: Track audio/video setup, waaz relay, screens, speakers, microphones, streaming, recording, power needs, testing windows, and coordination with site/electrical. Flag missing requirements or dependencies as issues.",
  },
  {
    patterns: [/communication/, /\bpr\b/, /public relations/],
    prompt: "Communication/PR: Track announcements, relay-site content, FAQs, guides, public/private publishing, review approvals, helpdesk scripts, and messaging to jamaats or mumineen. Flag unclear publication rules, privacy restrictions, or missing content as issues.",
  },
  {
    patterns: [/finance/, /procurement/, /qardan/, /najwa/, /shukr/],
    prompt: "Finance/Procurement/Qardan: Track budgets, quotes, purchase approvals, vendor commitments, payment follow-ups, booth/table needs, receipts, and procurement dependencies. Flag missing costs or approval blockers as issues.",
  },
  {
    patterns: [/fire safety/],
    prompt: "Fire Safety: Track inspections, permits, egress routes, tent/building occupancy, extinguishers, safety staffing, compliance approvals, and site hazards. Flag any unresolved safety/compliance question as high priority.",
  },
  {
    patterns: [/flow management/],
    prompt: "Flow Management: Track crowd routes, entrances/exits, capacity, queueing, seating movement, checkpoints, signage dependencies, and volunteer placement. Flag bottlenecks, capacity uncertainty, or unclear routes as issues.",
  },
  {
    patterns: [/\bhr\b/, /human resources/],
    prompt: "HR: Track volunteer recruitment, staffing gaps, schedules, role assignments, onboarding, training, credential needs, and availability confirmations. Flag unfilled roles or attendance uncertainty as issues.",
  },
  {
    patterns: [/\bit\b/, /\bits\b/],
    prompt: "IT/ITS: Track WhatsApp agent/helpdesk, dashboard, login/database bugs, automations, website crawler, access control, data integrations, phone-number permissions, manual handoff, analytics, and deployment/repo work. Flag bugs, missing content, handoff ambiguity, or access issues as high priority.",
  },
  {
    patterns: [/follow-up/],
    prompt: "Follow-up: Track pending callbacks, unanswered requests, owner confirmations, escalations, reminders, and closure status. Flag stale or ownerless follow-ups as issues.",
  },
  {
    patterns: [/mawaid/],
    prompt: "Mawaid: Track food counts, jaman timing, seating/rahat/chair blocks, partitions, serving flow, vendor/kitchen readiness, dietary needs, and coordination with site/sabeel. Flag count uncertainty or partition/seating blockers as issues.",
  },
  {
    patterns: [/medical/],
    prompt: "Medical: Track medical staffing, supplies, first-aid stations, emergency routes, patient-flow concerns, equipment, and shift coverage. Flag supply gaps or coverage risks as high priority issues.",
  },
  {
    patterns: [/mumineen reception/, /reception/],
    prompt: "Mumineen Reception: Track welcome desk setup, registration/check-in, guest guidance, information desk staffing, forms, badge/material handouts, and common attendee questions. Flag missing scripts or staffing gaps as issues.",
  },
  {
    patterns: [/nazafat/, /venue preparation/],
    prompt: "Nazafat/Venue Preparation: Track cleaning, venue readiness, setup/teardown, supplies, waste flow, room readiness, and dependencies on site/mawaid/flow. Flag readiness blockers as issues.",
  },
  {
    patterns: [/online niyaz/, /niyaz araz/],
    prompt: "Online Niyaz Araz: Track form readiness, payment/confirmation flow, data exports, support questions, reconciliation, and access issues. Flag broken forms or unclear submission status as issues.",
  },
  {
    patterns: [/photography/],
    prompt: "Photography: Track photo/video coverage plans, photographer assignments, access permissions, shot lists, delivery timelines, and coordination with PR/communications. Flag missing coverage or permission issues as blockers.",
  },
  {
    patterns: [/project management/, /\bpmo\b/],
    prompt: "Project Management: Track cross-team milestones, status reporting, PM meetings, dashboards, open blockers, ownerless tasks, escalation items, and daily updates. Convert unresolved cross-team questions into issues.",
  },
  {
    patterns: [/rahat support/, /\brahat\b/],
    prompt: "Rahat Support: Track seating/chair blocks, accessibility support, volunteer coverage, elderly/special-needs assistance, queue support, and coordination with mawaid/site/flow. Flag missing coverage or unclear seating assumptions as issues.",
  },
  {
    patterns: [/sabeel/],
    prompt: "Sabeel: Track sabeel location, snacks/tea/milk schedule, water coolers, hose bibs/water sources, refilling logistics, supplies, volunteer coverage, and site dependencies. Flag location or water-source uncertainty as issues.",
  },
  {
    patterns: [/scanning/],
    prompt: "Scanning: Track scanner/device readiness, access lists, check-in lanes, badge/QR workflows, staffing, troubleshooting, and data sync issues. Flag equipment or access failures as high priority.",
  },
  {
    patterns: [/security/],
    prompt: "Security: Track guard assignments, access control, entry/exit rules, incident response, restricted areas, crowd safety, and coordination with flow/fire safety. Flag security or access ambiguity as high priority.",
  },
  {
    patterns: [/site/, /construction/],
    prompt: "Site/Construction: Track HVAC, generators, electrical surveys/site plans, tent/seating capacity, water sources, sabeel placement, partitions, vendor calls, rentals, permits, inspections, map/site-layout updates, and dependencies with AV/mawaid/flow. Flag capacity, utility, vendor, or layout uncertainty as issues.",
  },
  {
    patterns: [/tazyeen/, /signage/, /signages/],
    prompt: "Tazyeen & Signages: Track decor/signage requirements, wayfinding signs, print/design approvals, placement maps, install timing, and dependencies from flow/site/communications. Flag missing copy, placement, or approval as issues.",
  },
  {
    patterns: [/\btnc\b/],
    prompt: "TNC: Track coordination requests, committee decisions, policy constraints, escalation items, and cross-functional dependencies. Flag unclear approvals or unresolved governance questions as issues.",
  },
  {
    patterns: [/istibsaar/],
    prompt: "Istibsaar: Track program/session readiness, participant needs, materials, room/setup requirements, volunteer support, and schedule changes. Flag missing resources or unclear ownership as issues.",
  },
  {
    patterns: [/hifz/],
    prompt: "Hifz: Track hifz program scheduling, participants, instructors, rooms, materials, and coordination needs. Flag schedule/resource gaps as issues.",
  },
  {
    patterns: [/translation/],
    prompt: "Translations: Track translation staffing, language needs, scripts/content, AV coordination, distribution channels, and review approvals. Flag missing translators or content readiness as issues.",
  },
  {
    patterns: [/transport/],
    prompt: "Transport: Track shuttles, drivers, vehicles, pickup/dropoff zones, ride-share guidance, airport/hotel routes, schedules, and communication to mumineen. Flag route/timing/capacity uncertainty as issues.",
  },
  {
    patterns: [/waaz talaqqi/, /talaqqi/],
    prompt: "Waaz Talaqqi: Track waaz relay/talaqqi logistics, seating assumptions, timing, access, AV/site dependencies, and attendee-flow questions. Flag capacity or readiness uncertainty as issues.",
  },
  {
    patterns: [/zakereen/],
    prompt: "Zakereen: Track zakereen schedules, assignments, room/stage needs, transport/accommodation dependencies, and content/program readiness. Flag missing confirmations as issues.",
  },
  {
    patterns: [/karamat/],
    prompt: "Karamat: Track karamat planning, materials, staffing, distribution, schedule, and coordination dependencies. Flag unclear ownership or supply gaps as issues.",
  },
];

export function getDefaultFlexiblePrompt(
  departmentName?: string | null,
  transcriptType: TranscriptType = "whatsapp",
): string {
  const normalized = departmentName?.trim().toLowerCase() ?? "";
  const matchingRule = departmentRules.find((rule) => rule.patterns.some((pattern) => pattern.test(normalized)))?.prompt;
  const transcriptRule = transcriptType === "meeting" ? meetingPromptSuffix : whatsappPromptSuffix;

  return [defaultPrompt, transcriptRule, matchingRule].filter(Boolean).join("\n\n");
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
