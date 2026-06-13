import type OpenAI from "openai";

import { canUseTool, canUseTaskToolForCaller, publicTools, taskReadTools, taskWriteTools, taskCreateTools, leadershipTools, type AppUser } from "@/lib/permissions";
import { retrieveReligiousContext, retrieveSiteContext, RELIGIOUS_FALLBACK_MIN_SCORE } from "@/lib/scraper/retrieve-site-context";
import { lookupLisanWord } from "@/lib/knowledge/lisan-words";
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
        "Look up the meaning of a single Lisan ud Dawat word in the official dictionary (exact lookup). Use this whenever a user asks what a Lisan ud Dawat / Lisaan ud Dawat word means, or how to say a word. Returns the exact entry, or close 'did you mean' suggestions if the word isn't found exactly. NEVER answer a word's meaning from general knowledge.",
      parameters: {
        type: "object",
        properties: {
          word: {
            type: "string",
            description: "The single word to look up, as the user typed it (Roman transliteration or Lisan script).",
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
      name: "move_to_escalation",
      description:
        "Hand the conversation to the human team. TWO uses: (1) LAST RESORT for logistics — only after you genuinely tried get_site_content_faq and still cannot, or the user is clearly frustrated after you tried, or an emergency (lost child, lost passport, medical, security); never escalate just because someone asks for a person early on. (2) RELIGIOUS FOLLOW-UP — a genuine Waaz/deen question the reflections can't answer, or a personal fiqh/fatwa question: call with category 'religious_followup' so the team can follow up (the system sends a fixed reply; do not add your own).",
      parameters: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            description: "Concise reason for escalating, including what you already tried.",
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
              "other",
            ],
            description:
              "Best-fit category for routing. Use 'religious_followup' for a Waaz/deen question the reflections can't answer (or a personal fiqh/fatwa question).",
          },
          department: {
            type: "string",
            description:
              "Name of the department that should handle this escalation. Pick the best match from the Available Departments list in your system prompt.",
          },
        },
        required: ["reason", "priority", "category"],
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
        "Get the caller's family's current jaman (meal) Niyaz RSVP for Ashara — every event (Pehli Raat, lunch thaals, dinners) with how many of the family are currently down as attending vs. their family size. Each grid row includes `adults` and `kids` (the attending counts, split by age), `attending` (total) and `total` (family size), plus a `dateLabel` (e.g. \"Mon, Jun 15\") with the weekday already worked out — use the adults/kids breakdown and the dateLabel verbatim when reading the RSVP back to the user. The response also includes `familyMembers` — an array of {name, isAdult, isHead, notAttending} for each roster-active member. Use this to list names when the user claims more people than the family has. RSVP is pre-set for everyone from their arrival date, so use this to show what's already on file before changing it. RSVP is tracked for the whole family. If the caller isn't linked to a registered family, status will be 'unregistered' with any existing unregistered RSVPs in `rsvps`.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "set_family_meal_rsvps",
      description:
        "Update the caller's family's jaman (meal) Niyaz RSVP. Attendance is already pre-set for everyone from their arrival date, so use this mainly to record CHANGES — most often when the family says they will NOT attend on some day(s). Each entry marks the family attending (true) or not (false) for specific dates, or for ALL days (omit dates or set all=true), optionally narrowed to one meal. The change applies to the WHOLE family. Always confirm back to the user. For PARTIAL attendance (e.g. 'only 1 adult on the 21st'), pass adults and/or kids with the entries — the system keeps the head of family attending first, then other adults, then kids, and marks the rest not-attending for those events. For unregistered callers (status 'unregistered'), adults/kids/its_number record their count. NEVER pass adults/kids higher than the family size — if you do, the system caps the count at the family size and returns a `clamped` object ({requestedAdults, requestedKids, maxAdults, maxKids, message}); when present you MUST tell the user the RSVP was capped at their registered family and the extra people must message this number from their own phones to register separately. Examples: 'we won't be there on the 16th' -> {attending:false, dates:['2026-06-16']}; 'skip all the dinners' -> {attending:false, meal:'dinner', all:true}; 'only 1 adult for dinner on the 21st' -> {entries:[{attending:true, dates:['2026-06-21'], meal:'dinner'}], adults:1, kids:0}.",
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
                titles: {
                  type: "array",
                  items: { type: "string", description: "An event title copied EXACTLY from the grid/events list, e.g. 'Pehli Raat', '2nd Moharram ul Haram', 'Ashura'." },
                  description: "PREFERRED way to target a named event. Copy the title verbatim from get_family_meal_rsvps — the server resolves it to the correct date, so you never guess. A title like '2nd Moharram ul Haram' exists as BOTH a lunch and a dinner on different days, so ALWAYS pair titles with `meal`.",
                },
                dates: {
                  type: "array",
                  items: { type: "string", description: "A date in YYYY-MM-DD." },
                  description: "Specific days to apply to, ONLY when the user gave an explicit calendar date. For named events (Pehli Raat, Nth Moharram, Ashura) use `titles` instead — never translate a name to a date yourself. Omit (or set all=true) to apply to every day.",
                },
                meal: { type: "string", enum: ["lunch", "dinner"], description: "Narrow to one meal; omit to apply to every event on the day(s). Required when using `titles` to disambiguate lunch vs dinner." },
                all: { type: "boolean", description: "Set true to apply to every day (same as omitting dates)." },
              },
              required: ["attending"],
              additionalProperties: false,
            },
          },
          adults: { type: "number", description: "Number of adults attending. For registered families, triggers partial attendance (only this many adults attend; head of family kept first). For unregistered callers, records their head count." },
          kids: { type: "number", description: "Number of kids attending. For registered families, triggers partial attendance (only this many kids attend). For unregistered callers, records their head count." },
          its_number: { type: "string", description: "ITS number (optional, for unregistered callers to help match to a family later)." },
        },
        required: ["entries"],
        additionalProperties: false,
      },
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
      description: "Create a ticket/task. Department members can create self-assigned tickets; PM/HOD/Leadership can assign tickets.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Task title." },
          department_name: { type: "string", description: "Department name." },
          description: { type: "string", description: "Task description." },
          assigned_to_alias: { type: "string", description: "Name of person to assign." },
          due_date: { type: "string", description: "Due date in YYYY-MM-DD format." },
          priority: {
            type: "string",
            enum: ["low", "medium", "high"],
            description: "Task priority. Defaults to medium.",
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
        const targetYear = yr.year ?? ref.year ?? null;
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
        const year = yr.year ?? LAST_COMPLETED_ASHARA_YEAR;
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
      const cats = decoration ? ["tazyeen"] : ["reflection", "al_dars", "overview"];
      const targetYear = yr.year ?? null;
      const ctx = await retrieveReligiousContext(query, 5, cats, targetYear, RELIGIOUS_FALLBACK_MIN_SCORE);
      if (ctx) {
        return {
          status: "ok", decision: "answer", source: "indexed_religious_content",
          year: targetYear ?? yearFromContext(ctx), context: ctx,
        };
      }
      if (targetYear === ACTIVE_ASHARA_YEAR) {
        const altCtx = await retrieveReligiousContext(query, 5, cats, LAST_COMPLETED_ASHARA_YEAR, RELIGIOUS_FALLBACK_MIN_SCORE);
        if (altCtx) return { decision: "offer_last", year: LAST_COMPLETED_ASHARA_YEAR };
      }
      return { decision: "not_found" };
    }
    case "get_lisan_word_meaning": {
      const word = String(args.word ?? "");
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
          priority: args.priority,
          category: args.category,
          department: args.department,
          source: "ai",
        },
      });
    case "flag_knowledge_gap":
      return flagKnowledgeGap(String(args.topic ?? "").trim(), args.question != null ? String(args.question) : null, context.phoneE164);
    case "get_family_meal_rsvps":
      return callInternalApi("/api/rsvp/meals", { phone: context.phoneE164 });
    case "set_family_meal_rsvps":
      return callInternalApi("/api/rsvp/meals", {
        method: "POST",
        phone: context.phoneE164,
        body: {
          entries: args.entries ?? [],
          // Forward head-count + ITS for unregistered callers; the API ignores them for registered families.
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

  return JSON.stringify(result).slice(0, 500);
}
