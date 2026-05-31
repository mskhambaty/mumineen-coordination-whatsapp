export const EXTRACT_PROJECT_EVENTS_FUNCTION_NAME = "extract_project_events";

export const PROJECT_EVENT_TYPES = [
  "milestone_created",
  "milestone_updated",
  "task_created",
  "task_updated",
  "issue_created",
  "issue_updated",
  "issue_resolved",
] as const;

export type ProjectEventType = (typeof PROJECT_EVENT_TYPES)[number];
export type ProjectStatus = "open" | "in_progress" | "blocked" | "complete";
export type ProjectPriority = "low" | "medium" | "high";
export type ProjectSource = "call_transcript" | "whatsapp_agent" | "manual";
export type ProjectItemType = "task" | "issue";

export type ExtractProjectEventData = {
  id: string | null;
  department_id: string | null;
  title: string | null;
  description: string | null;
  budget: number | null;
  percent_complete: number | null;
  status: ProjectStatus | null;
  notes: string | null;
  assigned_to: string | null;
  assigned_to_alias: string | null;
  source: ProjectSource | null;
  due_date: string | null;
  priority: ProjectPriority | null;
  milestone_id: string | null;
  item_type: ProjectItemType | null;
};

export type ExtractProjectEvent = {
  event_type: ProjectEventType;
  data: ExtractProjectEventData;
};

export type ExtractProjectEventsArgs = {
  events: ExtractProjectEvent[];
};

const nullableString = { type: ["string", "null"] };
const nullableNumber = { type: ["number", "null"] };

export const EXTRACT_PROJECT_EVENTS_TOOL = {
  type: "function",
  function: {
    name: EXTRACT_PROJECT_EVENTS_FUNCTION_NAME,
    description: "Return project milestone, task, and issue creation/update events extracted from an uploaded WhatsApp or meeting transcript.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["events"],
      properties: {
        events: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["event_type", "data"],
            properties: {
              event_type: { type: "string", enum: PROJECT_EVENT_TYPES },
              data: {
                type: "object",
                additionalProperties: false,
                required: [
                  "id",
                  "department_id",
                  "title",
                  "description",
                  "budget",
                  "percent_complete",
                  "status",
                  "notes",
                  "assigned_to",
                  "assigned_to_alias",
                  "source",
                  "due_date",
                  "priority",
                  "milestone_id",
                  "item_type",
                ],
                properties: {
                  id: nullableString,
                  department_id: nullableString,
                  title: nullableString,
                  description: nullableString,
                  budget: nullableNumber,
                  percent_complete: nullableNumber,
                  status: { type: ["string", "null"], enum: ["open", "in_progress", "blocked", "complete", null] },
                  notes: nullableString,
                  assigned_to: nullableString,
                  assigned_to_alias: nullableString,
                  source: { type: ["string", "null"], enum: ["call_transcript", "whatsapp_agent", "manual", null] },
                  due_date: nullableString,
                  priority: { type: ["string", "null"], enum: ["low", "medium", "high", null] },
                  milestone_id: nullableString,
                  item_type: { type: ["string", "null"], enum: ["task", "issue", null] },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

export const EXTRACT_PROJECT_EVENTS_SCHEMA_TEXT = JSON.stringify(EXTRACT_PROJECT_EVENTS_TOOL.function, null, 2);
