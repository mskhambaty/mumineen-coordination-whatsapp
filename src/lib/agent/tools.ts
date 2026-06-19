import type OpenAI from "openai";

import { canUseTool, canUseTaskToolForCaller, publicTools, taskReadTools, taskWriteTools, taskCreateTools, leadershipTools, type AppUser } from "@/lib/permissions";
import { retrieveReligiousContext, retrieveSiteContext, RELIGIOUS_FALLBACK_MIN_SCORE } from "@/lib/scraper/retrieve-site-context";
import { lookupEnglishMeaning, lookupLisanWord } from "@/lib/knowledge/lisan-words";
import { recordMissingLisanWord } from "@/lib/knowledge/lisan-word-requests";
import { maybeSingleWordQuery } from "@/lib/agent/religious-guard";
import { ACTIVE_ASHARA_YEAR, LAST_COMPLETED_ASHARA_YEAR, resolveAsharaYear } from "@/lib/knowledge/ashara-config";
import {
  availableFacets,
  findMajlisForRef,
  getOverviewBlock,
  isDeepQuery,
  isOverviewQuery,
  listMajlisThemes,
  parseMajlisRef,
} from "@/lib/knowledge/religious-topics";
import { recordToolAudit } from "@/lib/supabase/server";
import { recordKnowledgeGap } from "@/lib/knowledge/knowledge-gaps";
import type { CallerContext } from "@/lib/api/auth";
import {
  resolveUniqueName,
  selectTasksForAgentUpdate,
  updateTasksInputSchema,
  type AgentTask,
} from "@/lib/tasks/agent-management";

type ToolInput = Record<string, unknown>;

type ToolContext = {
  user: AppUser;
  phoneE164: string;
  callerContext?: CallerContext;
};

type ToolDefinition = OpenAI.Chat.Completions.ChatCompletionTool;

// Return only the tool definitions the caller's role permits. Sending fewer
// tools reduces input tokens on every LLM call — the model never needs to see
// task-management or committee tools when it's talking to a visitor.
export function toolDefinitionsFor(user: Pick<AppUser, "role" | "status">): ToolDefinition[] {
  return allToolDefinitions.filter((t) => {
    if (t.type !== "function") return false;
    const name = t.function.name;
    if (publicTools.has(name)) return true;
    if (taskReadTools.has(name) || taskCreateTools.has(name) || taskWriteTools.has(name) || leadershipTools.has(name)) {
      return user.role === "committee" || user.role === "admin";
    }
    return false;
  });
}

export const allToolDefinitions: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "get_site_content_faq",
      description:
        "Look up answers to public visitor questions (schedule, parking, directions, accommodation/hotels, registration, lost and found, general FAQs) from the indexed official site content. Always try this before telling a visitor that information is unavailable.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The visitor's question or topic to look up in the indexed site content.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "answer_religious_questions",
      description:
        "Look up answers to religious / sermon questions about Ashara Mubarak — Vaaz Talaqi (understanding the daily majalis/waaz), the Iqtibasaat (Quranic/hadith references used in the bayan), and the Tazyeen/decoration of a majlis — from the indexed religious content. ALWAYS use this for any Vaaz, majlis, Iqtibas, or Tazyeen/decoration question. Never answer such questions from general knowledge or from get_site_content_faq. For the meaning of a single Lisan ud Dawat WORD, use get_lisan_word_meaning instead.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "The religious / Vaaz / Iqtibas / Tazyeen question or topic to look up in the indexed religious content.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_lisan_word_meaning",
      description:
        "Two-way Lisan ud Dawat dictionary lookup. DEFAULT (direction 'to_english'): the user gives a Lisan ud Dawat word and wants its English meaning — returns the exact entry or close 'did you mean' suggestions. REVERSE (direction 'to_lisan'): the user asks for the Lisan ud Dawat WORD for an English term (e.g. 'what is the lisan word for brain', 'how do you say patience in lisan') — pass the English term in `word` and set direction 'to_lisan'. NEVER answer a word's meaning from general knowledge.",
      parameters: {
        type: "object",
        properties: {
          word: {
            type: "string",
            description:
              "The term to look up: for 'to_english', the Lisan word as typed (Roman or Lisan script); for 'to_lisan', the English word the user wants the Lisan term for.",
          },
          direction: {
            type: "string",
            enum: ["to_english", "to_lisan"],
            description:
              "'to_english' (default) = Lisan word → English meaning. 'to_lisan' = English word → Lisan ud Dawat word.",
          },
        },
        required: ["word"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "report_lost_item",
      description:
        "Record a visitor's lost-item report and automatically escalate it to the Lost and Found team. Gather a useful item name/description and ask where it was last seen; include color/brand when known. If Sender Context does not show a registered roster profile, ask for the reporter's name and ITS number (if they have one) before calling. After success, tell them the team will follow up and that pickup is at any help desk in the masjid complex.",
      parameters: {
        type: "object",
        properties: {
          item_name: { type: "string", description: "Short name of the lost item, e.g. 'black backpack'." },
          description: { type: "string", description: "Distinctive details that will help identify the item." },
          category: { type: "string", description: "Optional broad category, e.g. bag, clothing, electronics, document." },
          color: { type: "string", description: "Item color, when known." },
          brand: { type: "string", description: "Brand or maker, when known." },
          location: { type: "string", description: "Where the item was last seen." },
          occurred_at: { type: "string", description: "ISO 8601 timestamp when it was lost, only when the reporter provided a date/time." },
          reporter_name: { type: "string", description: "Reporter name, needed when Sender Context has no registered profile." },
          reporter_its: { type: "string", description: "Reporter ITS number, when provided." },
        },
        required: ["item_name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "report_found_item",
      description:
        "Record an item that a visitor found. Gather a useful item name/description and where it was found; include color/brand when known. If Sender Context does not show a registered roster profile, ask for the reporter's name and ITS number (if they have one) before calling. After success, tell them to drop it off at any help desk in the masjid complex.",
      parameters: {
        type: "object",
        properties: {
          item_name: { type: "string", description: "Short name of the found item, e.g. 'blue water bottle'." },
          description: { type: "string", description: "Distinctive details that will help identify the item." },
          category: { type: "string", description: "Optional broad category, e.g. bag, clothing, electronics, document." },
          color: { type: "string", description: "Item color, when known." },
          brand: { type: "string", description: "Brand or maker, when known." },
          location: { type: "string", description: "Where the item was found." },
          occurred_at: { type: "string", description: "ISO 8601 timestamp when it was found, only when the reporter provided a date/time." },
          reporter_name: { type: "string", description: "Reporter name, needed when Sender Context has no registered profile." },
          reporter_its: { type: "string", description: "Reporter ITS number, when provided." },
        },
        required: ["item_name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "move_to_escalation",
      description:
        "Hand the conversation to the human team (on-call) for follow-up. This by itself does NOT create a tracked issue — a single person's request being escalated is not an issue. TWO uses: (1) LAST RESORT for logistics — only after you genuinely tried get_site_content_faq and still cannot, or the user is clearly frustrated after you tried, or an emergency (lost child, lost passport, medical, security); never escalate just because someone asks for a person early on. (2) RELIGIOUS FOLLOW-UP — a genuine Waaz/deen question the reflections can't answer, or a personal fiqh/fatwa question: call with category 'religious_followup' (the system sends a fixed reply; do not add your own). Set requires_department_coordination=true ONLY when the problem is an actionable issue a DEPARTMENT must coordinate to fix (see that field) — that is what creates a tracked issue, workspace task, and department notification.",
      parameters: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            description: "Concise reason for escalating, including what you already tried.",
          },
          title: {
            type: "string",
            description: "Short issue title summarizing the problem (e.g. 'Water bottles on Madressa 2nd floor'). Auto-generated from the user's message.",
          },
          description: {
            type: "string",
            description: "Detailed description of the issue for the department team. Include specifics from the user's message (location, what's wrong, urgency).",
          },
          priority: {
            type: "string",
            enum: ["normal", "urgent"],
            description: "Use 'urgent' for emergencies or strong distress; otherwise 'normal'.",
          },
          category: {
            type: "string",
            enum: [
              "emergency",
              "accommodation",
              "transport",
              "registration",
              "schedule",
              "facilities",
              "complaint",
              "religious_followup",
              "lost_found",
              "other",
            ],
            description:
              "Best-fit category for routing. Use 'religious_followup' for a Waaz/deen question the reflections can't answer (or a personal fiqh/fatwa question).",
          },
          department: {
            type: "string",
            description:
              "Name of the department that should handle this. ALWAYS pick the best match from the Available Departments list. Required for issue routing and notifications.",
          },
          requires_department_coordination: {
            type: "boolean",
            description:
              "Whether this needs a tracked ISSUE for a department to coordinate a fix. Set TRUE only for an actionable PROBLEM a department must act on — something broken, missing, unsafe, or not working (e.g. shuttle not running, AC out, water spill, supplies missing, a facility/safety problem). Set FALSE for an individual request, a question, an info/registration/parking-pass ask, a religious_followup, or a plain 'talk to a person' hand-off — those are handled in the conversation or by the on-call team and must NOT create an issue.",
          },
        },
        required: ["reason", "priority", "category", "title", "department", "requires_department_coordination"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "flag_knowledge_gap",
      description:
        "Log a knowledge gap when you genuinely CANNOT answer a visitor's INFORMATIONAL question because the topic isn't covered in get_site_content_faq (or any source available to you) — so the team can publish the info. Call this IN ADDITION to telling the user the details aren't available yet. Do NOT use it for: questions you can already answer; concrete problems to fix or human hand-offs (use move_to_escalation); accommodation/utaro or visa requests (use move_to_escalation or the relevant form). One call per distinct topic.",
      parameters: {
        type: "object",
        properties: {
          topic: {
            type: "string",
            description:
              "Short, reusable topic of the missing information (e.g. 'Markaz parking', 'Shuttle timings', 'Stroller policy') — not the verbatim question.",
          },
          question: {
            type: "string",
            description: "The visitor's actual question, briefly.",
          },
        },
        required: ["topic"],
        additionalProperties: false,
      },
    },
  },
  // --- Meal RSVP & Feedback (public) ---
  {
    type: "function",
    function: {
      name: "get_family_meal_rsvps",
      description:
        "Get the caller's family's current jaman (meal) Niyaz RSVP for Ashara, organised per DAY. The response has a `days` array — one entry per Gregorian day (today→Ashura), each with `date` (YYYY-MM-DD), `title` (the day's name, e.g. \"1st Moharram ul Haram\"), `dateLabel` (e.g. \"Mon, Jun 15\", weekday already worked out — use verbatim), and `lunch`/`dinner` columns. Each meal column is either an object `{attending, total}` (attending count vs family size) or null when that meal isn't served that day (Pehli Raat and Ashura are dinner-only). Each day also has `closed` (boolean) and `closedLabel` — when `closed` is true the day's RSVP cutoff has passed and it can no longer be changed; note it as closed and don't offer to change that day. Read the RSVP back to the user one line PER DAY using the title, dateLabel, and a single attending count per served meal. The response also includes `familyMembers` — an array of {name, isAdult, isHead, notAttending} for each roster-active member; use it to list names when the user claims more people than the family has. RSVP is pre-set for everyone from their arrival date, so use this to show what's already on file before changing it. RSVP is tracked for the whole family. If the caller isn't linked to a registered family, status will be 'unregistered' with the per-day jaman list in `events` and any existing unregistered RSVPs in `rsvps`.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "set_family_meal_rsvps",
      description:
        "Update the caller's family's jaman (meal) Niyaz RSVP. Attendance is already pre-set for everyone from their arrival date, so use this mainly to record CHANGES — most often when the family says they will NOT attend on some day(s). To target a change, COPY the `date` of the relevant day row from get_family_meal_rsvps verbatim into the entry's `dates` and set `meal` to the column the user means (lunch/dinner) — each (date, meal) is exactly one jaman, so this never mis-targets. Omit dates (or set all=true) to apply to every day. The change applies to the WHOLE family. Always confirm back to the user. For PARTIAL attendance (e.g. 'only 1 adult on the 21st'), pass adults and/or kids with the entries — the system keeps the head of family attending first, then other adults, then kids, and marks the rest not-attending for those events. For unregistered callers (status 'unregistered'), adults/kids/its_number record their count. NEVER pass adults/kids higher than the family size — if you do, the system caps the count at the family size and returns a `clamped` object ({requestedAdults, requestedKids, maxAdults, maxKids, message}); when present you MUST tell the user the RSVP was capped at their registered family and the extra people must message this number from their own phones to register separately. Examples: 'we won't be there on the 16th' -> {attending:false, dates:['2026-06-16']}; 'skip all the dinners' -> {attending:false, meal:'dinner', all:true}; 'only 1 adult for dinner on the 21st' -> {entries:[{attending:true, dates:['2026-06-21'], meal:'dinner'}], adults:1, kids:0}. RSVP CLOSES PER DAY: a day past its cutoff is locked — that day's change is NOT applied and the response returns a `blocked` array ({title, date, endLabel}). When `blocked` is present you MUST tell the user RSVP for that day has closed (cite title + endLabel) so it couldn't be changed; days not in `blocked` were applied.",
      parameters: {
        type: "object",
        properties: {
          entries: {
            type: "array",
            description: "One or more RSVP changes to apply.",
            items: {
              type: "object",
              properties: {
                attending: { type: "boolean", description: "true if the family will attend, false if not." },
                dates: {
                  type: "array",
                  items: { type: "string", description: "A date in YYYY-MM-DD, copied verbatim from a day row's `date` in get_family_meal_rsvps." },
                  description: "PREFERRED way to target days. Copy the `date` of the relevant day row from get_family_meal_rsvps verbatim — NEVER work out a date yourself from a jaman's name. Pair with `meal` to hit a specific meal that day. Omit (or set all=true) to apply to every day.",
                },
                titles: {
                  type: "array",
                  items: { type: "string", description: "An event title, e.g. 'Pehli Raat', '2nd Moharram ul Haram', 'Ashura'." },
                  description: "Legacy/fallback selector — prefer `dates`+`meal` copied from the day row. The server resolves a title to its date; a title like '2nd Moharram ul Haram' exists as BOTH a lunch and a dinner on different days, so ALWAYS pair titles with `meal`.",
                },
                meal: { type: "string", enum: ["lunch", "dinner"], description: "Narrow to one meal; omit to apply to every meal on the day(s). Pair with `dates` (or `titles`) to target a specific lunch or dinner." },
                all: { type: "boolean", description: "Set true to apply to every day (same as omitting dates)." },
              },
              required: ["attending"],
              additionalProperties: false,
            },
          },
          total: { type: "number", description: "PREFERRED for a bare head count with no adult/kid split (e.g. 'change to 5 for dinner', '5 of us are coming'). The system fills that many attendees in priority order — head of family first, then other adults, then kids — and caps at the registered family size. Use this instead of guessing adults vs kids; only use adults/kids when the user explicitly states the split or which members attend." },
          adults: { type: "number", description: "Number of ADULTS attending — use ONLY when the user explicitly gives an adult/kid split (e.g. '2 adults and 1 kid') or names which members. Do NOT put a bare total here — use `total`. Head of family kept first. For unregistered callers, records their head count." },
          kids: { type: "number", description: "Number of KIDS attending — use ONLY alongside `adults` when the user explicitly states the split. For unregistered callers, records their head count." },
          its_number: { type: "string", description: "ITS number (optional, for unregistered callers to help match to a family later)." },
        },
        required: ["entries"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_family_parking_passes",
      description:
        "Look up the parking pass(es) allocated to the CALLER'S OWN family for Ashara. Identified by the caller's WhatsApp number — it ONLY ever returns the caller's own family's passes, so use it solely for the person you're chatting with or their family, never to look up anyone else. Returns each pass's lot name and color, the entry point for that color (plus the special purpose for gold = wheelchair support and green = khidmat guzaar early-access), general access (southbound Route 83 / Kingery Hwy), and the rideshare drop-off (Wat Buddha Damma Meditation Center). status 'ok' with passes; 'no_passes' if the family has none; 'unregistered' if the number isn't linked to a registered family. For 'no_passes'/'unregistered', ask whether they need a pass and escalate to Transport. The DB has no collection status, so ASK the user whether they've already collected their pass. Takes no arguments.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  // --- Task Management Tools ---
  {
    type: "function",
    function: {
      name: "list_tasks",
      description: "List the tickets/tasks the caller can access. ALWAYS returns ticket IDs. Use filters or query for open-ticket summaries, department views, blockers, or finding a ticket before discussing it.",
      parameters: {
        type: "object",
        properties: {
          statuses: {
            type: "array",
            items: {
              type: "string",
              enum: ["open", "in_progress", "blocked", "complete"],
            },
            description: "Optional current-status filters.",
          },
          priorities: {
            type: "array",
            items: {
              type: "string",
              enum: ["low", "medium", "high"],
            },
            description: "Optional priority filters.",
          },
          department_name: { type: "string", description: "Optional department name filter." },
          query: { type: "string", description: "Optional title/description keyword search." },
          include_archived: { type: "boolean", description: "Include archived tickets. Defaults to false." },
          view: {
            type: "string",
            enum: ["list", "kanban"],
            description: "Return a list or kanban-style board.",
          },
          limit: { type: "number", description: "Maximum list results, from 1 to 50. Defaults to 25." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_departments",
      description: "List departments available to the caller for ticket management, including exact names and IDs. Use before moving or creating a ticket when the department name is uncertain.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "list_department_members",
      description: "List active members of a department who can be assigned tickets. Returns names, IDs, and department roles without phone numbers or email addresses.",
      parameters: {
        type: "object",
        properties: {
          department_name: { type: "string", description: "Exact or unambiguous department name." },
        },
        required: ["department_name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_task",
      description: "Create an issue or task. Any user can report a problem as an issue (item_type 'issue') which notifies the department team. Committee members can also create tasks.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short title describing the issue or task." },
          department_name: { type: "string", description: "Department name to route this to." },
          description: { type: "string", description: "Detailed description of the problem or task." },
          item_type: {
            type: "string",
            enum: ["issue", "task"],
            description: "Use 'issue' for problems/complaints to report (default for external users). Use 'task' for internal work items.",
          },
          assigned_to_alias: { type: "string", description: "Name of person to assign (committee only)." },
          due_date: { type: "string", description: "Due date in YYYY-MM-DD format." },
          priority: {
            type: "string",
            enum: ["low", "medium", "high"],
            description: "Priority. Defaults to medium.",
          },
        },
        required: ["title", "department_name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_tasks",
      description: "Update one or many accessible tickets in ONE call. This tool resolves matching ticket IDs internally, so use it directly for requests like 'close all AI tickets' or 'move accommodation tickets to Accommodation'. It can change status, priority, title, description, department, assignee, due date, type, and archive state. Never claim success unless this result confirms the updated tickets.",
      parameters: {
        type: "object",
        properties: {
          selection: {
            type: "object",
            description: "Which currently accessible tickets to update.",
            properties: {
              task_ids: { type: "array", items: { type: "string" }, description: "Known ticket UUIDs." },
              query: { type: "string", description: "Topic/keyword match against title and description." },
              department_names: { type: "array", items: { type: "string" }, description: "Only tickets currently in these departments." },
              exclude_department_names: { type: "array", items: { type: "string" }, description: "Exclude tickets currently in these departments." },
              statuses: { type: "array", items: { type: "string", enum: ["open", "in_progress", "blocked", "complete"] } },
              priorities: { type: "array", items: { type: "string", enum: ["low", "medium", "high"] } },
              include_archived: { type: "boolean", description: "Allow archived tickets to match. Defaults to false." },
              all_matching: { type: "boolean", description: "Set true ONLY when the user explicitly asked to update every matching ticket." },
            },
            required: ["all_matching"],
            additionalProperties: false,
          },
          updates: {
            type: "object",
            description: "Fields to change. At least one is required.",
            properties: {
              status: { type: "string", enum: ["open", "in_progress", "blocked", "complete"] },
              priority: { type: "string", enum: ["low", "medium", "high"] },
              title: { type: "string", description: "Only valid when exactly one ticket matches." },
              description: { type: "string", description: "Only valid when exactly one ticket matches." },
              clear_description: { type: "boolean" },
              department_name: { type: "string", description: "Move to this department." },
              assigned_to_name: { type: "string", description: "Assign to this active member of the target/current department." },
              unassign: { type: "boolean" },
              due_date: { type: "string", description: "YYYY-MM-DD." },
              clear_due_date: { type: "boolean" },
              item_type: { type: "string", enum: ["task", "issue"] },
              archived: { type: "boolean" },
            },
            additionalProperties: false,
          },
        },
        required: ["selection", "updates"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_milestones",
      description: "Get milestones for a department. Shows budget, completion %, and status.",
      parameters: {
        type: "object",
        properties: {
          department_name: { type: "string", description: "Department name." },
          status: {
            type: "string",
            enum: ["open", "in_progress", "blocked", "complete", "all"],
            description: "Filter by status.",
          },
        },
        required: ["department_name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_milestone",
      description: "Update a milestone's status, completion percentage, budget, or notes. Requires PM, HOD, or Leadership/Admin role.",
      parameters: {
        type: "object",
        properties: {
          milestone_id: { type: "string", description: "Milestone ID (UUID)." },
          status: {
            type: "string",
            enum: ["open", "in_progress", "blocked", "complete"],
            description: "New status.",
          },
          percent_complete: { type: "number", description: "Completion percentage (0-100)." },
          notes: { type: "string", description: "Notes or update details." },
        },
        required: ["milestone_id"],
        additionalProperties: false,
      },
    },
  },
];

export async function executeTool(name: string, args: ToolInput, context: ToolContext) {
  const allowed = canUseTool(context.user, name);

  if (!allowed) {
    const restricted = {
      status: "unavailable_to_agent",
      instruction:
        "You don't have access to this. Do NOT tell the user it's restricted or to contact the admin team. If they need a person or info you can't retrieve, warmly note their request and use move_to_escalation so the team follows up; otherwise keep helping.",
    };

    await recordToolAudit({
      userId: context.user.id,
      phoneE164: context.phoneE164,
      toolName: name,
      arguments: args,
      allowed: false,
      resultSummary: "Blocked: not permitted for this role",
    });

    return restricted;
  }

  // Additional permission check for task tools
  if (!canUseTaskToolForCaller(context.callerContext, name) && isTaskTool(name)) {
    const restricted = {
      error: `This action requires ${getRequiredRole(name)} access.`,
    };

    await recordToolAudit({
      userId: context.user.id,
      phoneE164: context.phoneE164,
      toolName: name,
      arguments: args,
      allowed: false,
      resultSummary: restricted.error,
    });

    return restricted;
  }

  const result = await runTool(name, args, context);

  await recordToolAudit({
    userId: context.user.id,
    phoneE164: context.phoneE164,
    toolName: name,
    arguments: args,
    allowed: true,
    resultSummary: summarizeResult(result),
  });

  return result;
}

async function flagKnowledgeGap(topic: string, question: string | null, phone: string) {
  const result = await recordKnowledgeGap(topic, question, phone);
  return { ...result, topic };
}

function isTaskTool(name: string): boolean {
  return [
    "list_tasks", "list_departments", "list_department_members",
    "update_tasks", "create_task",
    "get_milestones", "update_milestone",
  ].includes(name);
}

function getRequiredRole(name: string): string {
  if (name === "create_task") {
    return "department membership";
  }
  if (["update_tasks", "update_milestone"].includes(name)) {
    return "pm, hod, or leadership_admin";
  }
  return "any authenticated user";
}

function getBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return "http://localhost:3000";
}

async function callInternalApi(path: string, options: {
  method?: string;
  phone: string;
  body?: unknown;
}): Promise<unknown> {
  const url = `${getBaseUrl()}${path}`;
  const res = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      "x-whatsapp-from": options.phone,
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });

  return res.json();
}

type DepartmentRef = { id: string; name: string; description?: string | null };
type DepartmentMemberRef = { id: string; display_name: string | null; department_role: string };

async function getDepartmentsForCaller(phone: string): Promise<DepartmentRef[] | { error: string }> {
  const result = await callInternalApi("/api/departments", { phone });
  return Array.isArray(result) ? result as DepartmentRef[] : { error: "Could not fetch departments." };
}

async function resolveDepartmentForCaller(phone: string, requestedName: string) {
  const departments = await getDepartmentsForCaller(phone);
  if (!Array.isArray(departments)) return departments;
  const resolved = resolveUniqueName(departments, requestedName, "Department");
  return resolved.item ?? { error: resolved.error ?? `Department not found: ${requestedName}` };
}

async function getDepartmentMembersForCaller(phone: string, departmentId: string) {
  const result = await callInternalApi(`/api/departments/${departmentId}/members`, { phone });
  return Array.isArray(result) ? result as DepartmentMemberRef[] : result;
}

export async function updateTasksFromAgent(args: ToolInput, context: ToolContext) {
  const parsed = updateTasksInputSchema.safeParse(args);
  if (!parsed.success) {
    return { error: parsed.error.issues.map((issue) => issue.message).join("; ") };
  }

  const { selection, updates } = parsed.data;
  if (Object.keys(updates).length === 0) {
    return { error: "At least one update field is required." };
  }

  const params = new URLSearchParams();
  if (selection.include_archived) params.set("include_archived", "true");
  const taskResult = await callInternalApi(`/api/tasks?${params.toString()}`, { phone: context.phoneE164 });
  if (!Array.isArray(taskResult)) return taskResult;

  const matched = selectTasksForAgentUpdate(taskResult as AgentTask[], selection);
  if (matched.error) return { error: matched.error };
  if (matched.selected.length > 1 && (updates.title !== undefined || updates.description !== undefined || updates.clear_description)) {
    return { error: "Title and description can only be changed when exactly one ticket matches." };
  }

  const updateBody: Record<string, unknown> = {};
  if (updates.status !== undefined) updateBody.status = updates.status;
  if (updates.priority !== undefined) updateBody.priority = updates.priority;
  if (updates.title !== undefined) updateBody.title = updates.title;
  if (updates.description !== undefined) updateBody.description = updates.description;
  if (updates.clear_description) updateBody.description = null;
  if (updates.due_date !== undefined) updateBody.due_date = updates.due_date;
  if (updates.clear_due_date) updateBody.due_date = null;
  if (updates.item_type !== undefined) updateBody.item_type = updates.item_type;
  if (updates.archived !== undefined) updateBody.archived = updates.archived;
  if (updates.unassign) updateBody.assigned_to = null;

  let targetDepartment: DepartmentRef | undefined;
  if (updates.department_name) {
    const resolved = await resolveDepartmentForCaller(context.phoneE164, updates.department_name);
    if ("error" in resolved) return resolved;
    targetDepartment = resolved;
    updateBody.department_id = resolved.id;
  }

  if (updates.assigned_to_name) {
    const departmentIds = new Set(
      matched.selected.map((task) => targetDepartment?.id ?? task.department_id).filter((id): id is string => Boolean(id)),
    );
    if (departmentIds.size !== 1) {
      return { error: "Assigning a person requires all matched tickets to share one target department." };
    }
    const departmentId = Array.from(departmentIds)[0];
    const members = await getDepartmentMembersForCaller(context.phoneE164, departmentId);
    if (!Array.isArray(members)) return members;
    const namedMembers = members
      .filter((member) => member.display_name)
      .map((member) => ({ ...member, name: member.display_name as string }));
    const resolved = resolveUniqueName(namedMembers, updates.assigned_to_name, "Department member");
    if (!resolved.item) return { error: resolved.error };
    updateBody.assigned_to = resolved.item.id;
  }

  const updated: unknown[] = [];
  const failed: Array<{ id: string; title: string; error: unknown }> = [];
  for (const task of matched.selected) {
    const result = await callInternalApi(`/api/tasks/${task.id}`, {
      method: "PUT",
      phone: context.phoneE164,
      body: updateBody,
    });
    if (typeof result === "object" && result !== null && "error" in result) {
      failed.push({ id: task.id, title: task.title, error: (result as { error: unknown }).error });
    } else {
      updated.push(result);
    }
  }

  return {
    matched_count: matched.selected.length,
    updated_count: updated.length,
    failed_count: failed.length,
    updated,
    failed,
  };
}

async function getIndexedInfo(
  query: string,
  fallbackMessage: string,
  retrieve: (q: string, topK?: number) => Promise<string>,
  source: string,
  topK = 5,
) {
  const context = await retrieve(query, topK);

  if (!context) {
    return {
      status: "no_indexed_match",
      message: fallbackMessage,
    };
  }

  return {
    status: "ok",
    source,
    context,
  };
}

async function runTool(name: string, args: ToolInput, context: ToolContext) {
  switch (name) {
    case "get_site_content_faq":
      // topK=10: curated FAQ chunks were being crowded out of a top-5 window; a wider
      // window lets the specific FAQ (e.g. WiFi, bathrooms) reach the model reliably.
      return getIndexedInfo(
        String(args.query ?? "Ashara 1448 Chicago visitor information"),
        "I could not find an answer in the indexed site content yet.",
        retrieveSiteContext,
        "indexed_site_content",
        10,
      );
    case "answer_religious_questions": {
      const query = String(args.query ?? "Ashara majlis Vaaz Talaqi Iqtibasaat");
      const today = new Date().toISOString().slice(0, 10);
      // Resolve "this year / today / last year / 1447" to a concrete event year. cue "none" → null.
      const yr = resolveAsharaYear(query, today);
      // F1: an UNqualified query (cue "none") must NOT search across years (which let last year's
      // 1447 content answer current questions — the cross-year "hallucination"). Default to the
      // active Ashara once it has started, else the last completed one. The offer_last fallbacks
      // below then turn "no active-year match" into "1448 isn't posted — want 1447?".
      const defaultYear = yr.activeStarted ? ACTIVE_ASHARA_YEAR : LAST_COMPLETED_ASHARA_YEAR;
      const renderHits = (hits: { title: string; content: string; source_url: string | null; theme?: string | null }[]) =>
        hits.map((t) => `[${t.title}${t.source_url ? ` — Source: ${t.source_url}` : ""}]\n${t.theme ? `Theme: ${t.theme}\n` : ""}${t.content}`).join("\n\n---\n\n");
      const yearFromContext = (s: string): string | null => {
        const m = s.match(/Ashara\s+(14\d\d)\s*H/i);
        return m ? m[1] : null;
      };

      // Decision contract (consumed deterministically by runAgent — the model only narrates an
      // "answer"): { decision: "answer", year, context, ... } | { decision: "offer_last" } |
      // { decision: "word_lookup", word } | { decision: "not_found" }. Only INDEXED + year-correct
      // content qualifies as an answer.

      // 0. A bare word-meaning ("meaning of X", "what does X mean") must come from the DICTIONARY,
      // never a loosely-matched sermon. Backstop for when the model routes a word here.
      const wordAsk = maybeSingleWordQuery(query);
      if (wordAsk?.forceAnswer) return { decision: "word_lookup", word: wordAsk.word };

      // 1. Specific majlis ("Majlis 2", "second waaz", "4th Muharram") → exact indexed block(s).
      const ref = parseMajlisRef(query);
      if (ref) {
        const targetYear = yr.year ?? ref.year ?? defaultYear;
        const hits = await findMajlisForRef({ ...ref, year: targetYear });
        if (hits.length) {
          const hitYear = hits[0].year_hijri ?? targetYear ?? null;
          const facets = await availableFacets({ ...ref, year: hitYear });
          return {
            status: "ok", decision: "answer", source: "religious_topic_exact",
            answer_style: isDeepQuery(query) ? "deep" : "brief",
            year: hitYear, available_facets: facets, context: renderHits(hits),
          };
        }
        // Explicitly asked for the active (unpublished) year, but last year has it → offer.
        if (targetYear === ACTIVE_ASHARA_YEAR) {
          const altHits = await findMajlisForRef({ ...ref, year: LAST_COMPLETED_ASHARA_YEAR });
          if (altHits.length) return { decision: "offer_last", year: LAST_COMPLETED_ASHARA_YEAR };
        }
        return { decision: "not_found" };
      }

      // 2. Overview intent → curated year-level block + per-majlis theme list (both status-filtered).
      if (isOverviewQuery(query)) {
        const overviewCtx = async (y: string): Promise<string> => {
          const block = await getOverviewBlock(y);
          const themes = await listMajlisThemes(y);
          const parts: string[] = [];
          if (block) parts.push(`[${block.title}${block.source_url ? ` — Source: ${block.source_url}` : ""}]\n${block.content}`);
          if (themes.length) parts.push(`Majlis themes — Ashara ${y}H:\n` + themes.map((t) => `- ${t.majlisLabel}: ${t.theme}`).join("\n"));
          return parts.join("\n\n---\n\n");
        };
        const year = yr.year ?? defaultYear;
        const ctx = await overviewCtx(year);
        if (ctx) return { status: "ok", decision: "answer", source: "religious_overview", answer_style: "overview", year, context: ctx };
        if (year === ACTIVE_ASHARA_YEAR) {
          const altCtx = await overviewCtx(LAST_COMPLETED_ASHARA_YEAR);
          if (altCtx) return { decision: "offer_last", year: LAST_COMPLETED_ASHARA_YEAR };
        }
        return { decision: "not_found" };
      }

      // 3. General religious question → YEAR-SCOPED, category-aware vector fallback. A 1448 query
      // is year-filtered to nothing (zero 1448 rows) so it can't relabel the embedded 1447 rows.
      const decoration = /\b(tazyeen|tazeen|tazyin|decorat|sajawat|sajaawat|artwork|calligraph)\b/i.test(query);
      // 'faq' = the curated per-majlis Q&A bucket; searched alongside the sermon sources so a member's
      // question matches a vetted answer (the Q text ranks high against the question's wording).
      const cats = decoration ? ["tazyeen"] : ["reflection", "al_dars", "overview", "faq"];
      const targetYear = yr.year ?? defaultYear;
      // F3: prefer the curated Q&A (faq) chunk — a vetted answer the weak model narrates verbatim —
      // over raw reflection prose when both match, for consistent replies.
      const ctx = await retrieveReligiousContext(query, 5, cats, targetYear, RELIGIOUS_FALLBACK_MIN_SCORE, "faq");
      if (ctx) {
        const year = targetYear ?? yearFromContext(ctx);
        // F2: derive the leading chunk's majlis+year so the follow-up only offers the al-Dars
        // deep-dive / tazyeen when that facet actually exists (path 1 returns this; path 3 didn't).
        const header = ctx.match(/^\[([^\]]+)\]/)?.[1] ?? "";
        const facetYear = header.match(/Ashara\s+(14\d\d)\s*H/i)?.[1] ?? year ?? null;
        const facetRef = parseMajlisRef(header);
        const facets = facetRef && facetYear ? await availableFacets({ ...facetRef, year: facetYear }) : undefined;
        return {
          status: "ok", decision: "answer", source: "indexed_religious_content",
          year, available_facets: facets, context: ctx,
        };
      }
      if (targetYear === ACTIVE_ASHARA_YEAR) {
        const altCtx = await retrieveReligiousContext(query, 5, cats, LAST_COMPLETED_ASHARA_YEAR, RELIGIOUS_FALLBACK_MIN_SCORE, "faq");
        if (altCtx) return { decision: "offer_last", year: LAST_COMPLETED_ASHARA_YEAR };
      }
      return { decision: "not_found" };
    }
    case "get_lisan_word_meaning": {
      const word = String(args.word ?? "");
      // Reverse direction (English → Lisan word): a miss is not a dictionary gap (the query is an
      // English word, not a Lisan one), so it is NOT queued for the team.
      if (args.direction === "to_lisan") {
        return await lookupEnglishMeaning(word);
      }
      const lookup = await lookupLisanWord(word);
      // A genuine gap (not_found, not a "did you mean") → queue it + alert the owner once so the
      // word can be added. Fire-and-forget; never blocks or breaks the member's reply.
      if (lookup.status === "not_found") void recordMissingLisanWord(word, context.phoneE164);
      return lookup;
    }
    case "move_to_escalation":
      return callInternalApi("/api/escalations", {
        method: "POST",
        phone: context.phoneE164,
        body: {
          reason: args.reason,
          title: args.title,
          description: args.description,
          priority: args.priority,
          category: args.category,
          department: args.department,
          requires_department_coordination: args.requires_department_coordination === true,
          source: "ai",
        },
      });
    case "report_lost_item":
    case "report_found_item":
      return callInternalApi("/api/lost-found", {
        method: "POST",
        phone: context.phoneE164,
        body: {
          report_type: name === "report_lost_item" ? "lost" : "found",
          item_name: args.item_name,
          description: args.description,
          category: args.category,
          color: args.color,
          brand: args.brand,
          location: args.location,
          occurred_at: args.occurred_at,
          reporter_name: args.reporter_name,
          reporter_its: args.reporter_its,
        },
      });
    case "flag_knowledge_gap":
      return flagKnowledgeGap(String(args.topic ?? "").trim(), args.question != null ? String(args.question) : null, context.phoneE164);
    case "get_family_meal_rsvps":
      return callInternalApi("/api/rsvp/meals", { phone: context.phoneE164 });
    case "get_family_parking_passes":
      return callInternalApi("/api/parking/my-passes", { phone: context.phoneE164 });
    case "set_family_meal_rsvps":
      return callInternalApi("/api/rsvp/meals", {
        method: "POST",
        phone: context.phoneE164,
        body: {
          entries: args.entries ?? [],
          // Forward head-count + ITS. `total` is a bare count (no adult/kid split); adults/kids are
          // the explicit split. For unregistered callers these record the head count.
          ...(args.total !== undefined ? { total: args.total } : {}),
          ...(args.adults !== undefined ? { adults: args.adults } : {}),
          ...(args.kids !== undefined ? { kids: args.kids } : {}),
          ...(args.its_number !== undefined ? { its_number: args.its_number } : {}),
        },
      });
    // --- Task Management Tools ---
    case "list_tasks": {
      const departmentName = typeof args.department_name === "string" ? args.department_name : undefined;
      const params = new URLSearchParams();
      if (departmentName) {
        const department = await resolveDepartmentForCaller(context.phoneE164, departmentName);
        if ("error" in department) return department;
        params.set("department_id", department.id);
      }
      if (args.include_archived === true) params.set("include_archived", "true");

      const tasks = await callInternalApi(`/api/tasks?${params.toString()}`, { phone: context.phoneE164 });
      if (!Array.isArray(tasks)) return tasks;
      const statuses = new Set(Array.isArray(args.statuses) ? args.statuses as string[] : []);
      const priorities = new Set(Array.isArray(args.priorities) ? args.priorities as string[] : []);
      const query = typeof args.query === "string" ? args.query : undefined;
      const filtered = (tasks as AgentTask[]).filter((task) => {
        if (statuses.size > 0 && !statuses.has(task.status ?? "")) return false;
        if (priorities.size > 0 && !priorities.has(task.priority ?? "")) return false;
        if (query) {
          const match = selectTasksForAgentUpdate([task], { query, all_matching: true, include_archived: args.include_archived === true });
          if (match.selected.length === 0) return false;
        }
        return true;
      });
      const limit = typeof args.limit === "number" ? Math.max(1, Math.min(50, Math.floor(args.limit))) : 25;
      if (args.view === "kanban") {
        return {
          open: filtered.filter((task) => task.status === "open"),
          in_progress: filtered.filter((task) => task.status === "in_progress"),
          blocked: filtered.filter((task) => task.status === "blocked"),
          complete: filtered.filter((task) => task.status === "complete"),
          board_url: `${getBaseUrl()}/admin/tasks`,
        };
      }
      return { count: filtered.length, tasks: filtered.slice(0, limit) };
    }
    case "list_departments":
      return getDepartmentsForCaller(context.phoneE164);
    case "list_department_members": {
      const department = await resolveDepartmentForCaller(context.phoneE164, String(args.department_name ?? ""));
      if ("error" in department) return department;
      return getDepartmentMembersForCaller(context.phoneE164, department.id);
    }
    case "update_tasks":
      return updateTasksFromAgent(args, context);
    case "create_task": {
      return callInternalApi("/api/tasks", {
        method: "POST",
        phone: context.phoneE164,
        body: {
          title: args.title,
          department_name: args.department_name,
          description: args.description,
          assigned_to_alias: args.assigned_to_alias,
          due_date: args.due_date,
          priority: args.priority,
          item_type: args.item_type ?? "task",
          source: "whatsapp_agent",
        },
      });
    }
    case "get_milestones": {
      const deptName = args.department_name as string;
      const depts = await callInternalApi("/api/departments", { phone: context.phoneE164 }) as Array<{ id: string; name: string }>;
      if (!Array.isArray(depts)) return { error: "Could not fetch departments" };
      const dept = depts.find((d) => d.name.toLowerCase() === deptName.toLowerCase());
      if (!dept) return { error: `Department not found: ${deptName}` };
      const status = (args.status as string) ?? "all";
      const params = new URLSearchParams({ department_id: dept.id });
      if (status !== "all") params.set("status", status);
      return callInternalApi(`/api/milestones?${params.toString()}`, { phone: context.phoneE164 });
    }
    case "update_milestone": {
      const updates: Record<string, unknown> = {};
      if (args.status) updates.status = args.status;
      if (typeof args.percent_complete === "number") updates.percent_complete = args.percent_complete;
      if (args.notes) updates.notes = args.notes;
      return callInternalApi(`/api/milestones/${args.milestone_id}`, {
        method: "PUT",
        phone: context.phoneE164,
        body: updates,
      });
    }
    default:
      return {
        error: `Unknown tool: ${name}`,
      };
  }
}

function summarizeResult(result: unknown) {
  if (typeof result === "string") {
    return result.slice(0, 500);
  }

  // Religious answer results carry a `decision` + a (possibly large) `context`. Store a structured,
  // VALID-JSON summary instead of a mid-string-truncated blob (the old slice(0,500) cut the JSON mid
  // `context`, so evals couldn't parse `decision`/`source` and saw only the FIRST matched chunk —
  // which made correct answers look wrong). `matched` keeps the titles / Q-headers of ALL retrieved
  // top-K chunks (identifiers, not bodies, so it stays bounded). Religious content is not PII.
  if (result && typeof result === "object" && "decision" in result) {
    const r = result as { decision?: unknown; year?: unknown; source?: unknown; context?: unknown };
    const matched: string[] = [];
    if (typeof r.context === "string") {
      for (const m of r.context.matchAll(/\[([^\]\n]{1,140})\]/g)) matched.push(`[${m[1].trim()}]`);
      for (const m of r.context.matchAll(/^Q:\s*([^\n]{1,140})/gim)) matched.push(`Q: ${m[1].trim()}`);
    }
    return JSON.stringify({
      decision: r.decision ?? null,
      year: r.year ?? null,
      source: r.source ?? null,
      matched: matched.slice(0, 8),
    });
  }

  return JSON.stringify(result).slice(0, 500);
}
