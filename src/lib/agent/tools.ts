import type OpenAI from "openai";

import { canUseTool, canUseTaskToolForCaller, type AppUser } from "@/lib/permissions";
import { retrieveReligiousContext, retrieveSiteContext } from "@/lib/scraper/retrieve-site-context";
import { recordToolAudit } from "@/lib/supabase/server";
import type { CallerContext } from "@/lib/api/auth";

type ToolInput = Record<string, unknown>;

type ToolContext = {
  user: AppUser;
  phoneE164: string;
  callerContext?: CallerContext;
};

type ToolDefinition = OpenAI.Chat.Completions.ChatCompletionTool;

export const toolDefinitions: ToolDefinition[] = [
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
        "Look up answers to religious / sermon questions about Ashara Mubarak — Vaaz Talaqi (understanding the daily majalis/waaz), Iqtibasaat (the Quranic/hadith references used in the bayan), and Lisan ud Dawat word meanings — from the indexed religious content. ALWAYS use this for any Vaaz, majlis, Iqtibas, or Lisan-word-meaning question. Never answer such questions from general knowledge or from get_site_content_faq.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "The religious / Vaaz / Iqtibas / Lisan-word question or topic to look up in the indexed religious content.",
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
      name: "move_to_escalation",
      description:
        "LAST RESORT ONLY. Hand the conversation to the human support team. Use this only after you have genuinely tried to help with get_site_content_faq and still cannot, or the user is clearly frustrated after you tried, or there is an emergency (lost child, lost passport, medical, security). Never escalate just because someone asks for a person early on — first ask what they need and try to help.",
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
              "other",
            ],
            description: "Best-fit category for routing.",
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
      name: "create_issue",
      description:
        "Log an issue ONLY for a concrete problem the visitor reports that the team needs to fix or track — e.g. a broken facility, a maintenance or safety problem, or a specific complaint. Do NOT use this to forward a query, connect the user to a person, hand off a conversation, or for accommodation/utaro requests — those are escalations (use move_to_escalation) or have their own form. Never use it for general questions you can answer with get_site_content_faq.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short summary of the issue." },
          description: { type: "string", description: "Details of what the visitor reported." },
          priority: {
            type: "string",
            enum: ["low", "medium", "high"],
            description: "Defaults to medium; use high for safety or time-sensitive problems.",
          },
          department: {
            type: "string",
            description:
              "Name of the department that should own this issue. Pick the best match from the Available Departments list in your system prompt.",
          },
        },
        required: ["title"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_volunteer_assignment",
      description: "Get a committee member's volunteer assignment.",
      parameters: {
        type: "object",
        properties: {
          phone_e164: { type: "string", description: "Optional phone number to look up." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lookup_committee_contact",
      description: "Look up an internal committee contact.",
      parameters: {
        type: "object",
        properties: {
          committee: { type: "string", description: "Committee name or function." },
        },
        required: ["committee"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_volunteer_status",
      description: "Update volunteer status for committee coordination.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", description: "New status." },
          note: { type: "string", description: "Optional note." },
        },
        required: ["status"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_internal_note",
      description: "Create an internal committee note.",
      parameters: {
        type: "object",
        properties: {
          note: { type: "string", description: "Internal note content." },
        },
        required: ["note"],
        additionalProperties: false,
      },
    },
  },
  // --- Task Management Tools ---
  {
    type: "function",
    function: {
      name: "get_my_tasks",
      description: "Get tasks assigned to the caller or in their departments. Use view=kanban when the user asks for their board.",
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["open", "in_progress", "blocked", "complete", "all"],
            description: "Filter by status. Defaults to all.",
          },
          priority: {
            type: "string",
            enum: ["low", "medium", "high", "all"],
            description: "Filter by priority. Defaults to all.",
          },
          view: {
            type: "string",
            enum: ["list", "kanban"],
            description: "Return a list or kanban-style board summary.",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_task_detail",
      description: "Get details of a specific task by ID or keyword search.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Task ID (UUID) or keyword to search." },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_department_summary",
      description: "Get a summary of tasks in a department (counts by status).",
      parameters: {
        type: "object",
        properties: {
          department_name: { type: "string", description: "Department name." },
        },
        required: ["department_name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_task_status",
      description: "Update the status of a task. Requires PM, HOD, or Leadership/Admin role.",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "Task ID (UUID)." },
          status: {
            type: "string",
            enum: ["open", "in_progress", "blocked", "complete"],
            description: "New status.",
          },
          note: { type: "string", description: "Optional note about the update." },
          priority: {
            type: "string",
            enum: ["low", "medium", "high"],
            description: "Optional priority update.",
          },
        },
        required: ["task_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_task",
      description: "Create a ticket/task. Department members can create tickets assigned to themselves; PM/HOD/Leadership can assign tickets.",
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
      name: "assign_task",
      description: "Assign a task to a person. Requires PM, HOD, or Leadership/Admin role.",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "Task ID (UUID)." },
          assign_to_alias: { type: "string", description: "Name of person to assign." },
        },
        required: ["task_id", "assign_to_alias"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_top_blockers",
      description: "Get the highest priority blocked or overdue tasks. Requires PM, HOD, or Leadership/Admin role.",
      parameters: {
        type: "object",
        properties: {
          department_name: { type: "string", description: "Optional department name." },
          limit: { type: "number", description: "Maximum number of blockers to return. Defaults to 5." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_all_departments_summary",
      description: "Get summary of all departments. Leadership/Admin only.",
      parameters: {
        type: "object",
        properties: {
          filter: {
            type: "string",
            enum: ["all", "blocked", "overdue", "on_track"],
            description: "Filter departments.",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_department_tasks",
      description: "Get all tasks in a specific department. Leadership/Admin only.",
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

function isTaskTool(name: string): boolean {
  return [
    "get_my_tasks", "get_task_detail", "get_department_summary",
    "update_task_status", "create_task", "assign_task", "get_top_blockers",
    "get_all_departments_summary", "get_department_tasks",
    "get_milestones", "update_milestone",
  ].includes(name);
}

function getRequiredRole(name: string): string {
  if (["get_all_departments_summary", "get_department_tasks"].includes(name)) {
    return "leadership_admin";
  }
  if (name === "create_task") {
    return "department membership";
  }
  if (["update_task_status", "assign_task", "get_top_blockers", "update_milestone"].includes(name)) {
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

async function getIndexedInfo(
  query: string,
  fallbackMessage: string,
  retrieve: (q: string, topK?: number) => Promise<string>,
  source: string,
) {
  const context = await retrieve(query, 5);

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
      return getIndexedInfo(
        String(args.query ?? "Ashara 1448 Chicago visitor information"),
        "I could not find an answer in the indexed site content yet.",
        retrieveSiteContext,
        "indexed_site_content",
      );
    case "answer_religious_questions":
      return getIndexedInfo(
        String(args.query ?? "Ashara majlis Vaaz Talaqi Iqtibasaat"),
        "I could not find this in the indexed religious content yet.",
        retrieveReligiousContext,
        "indexed_religious_content",
      );
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
    case "create_issue":
      return callInternalApi("/api/issues", {
        method: "POST",
        phone: context.phoneE164,
        body: {
          title: args.title,
          description: args.description,
          priority: args.priority,
          department: args.department,
        },
      });
    case "get_volunteer_assignment":
      return {
        status: "unavailable_to_agent",
        instruction:
          "This source is not available to you. Do NOT tell the user it is unavailable. If they need to reach a person, use move_to_escalation so the team follows up; otherwise keep helping them directly.",
        phone_e164: args.phone_e164 ?? context.phoneE164,
      };
    case "lookup_committee_contact":
      return {
        status: "unavailable_to_agent",
        committee: args.committee,
        instruction:
          "The directory is not available to you. Do NOT tell the user it is unavailable or 'not connected'. If they need to reach a person or live support, use move_to_escalation so a team member reaches out; otherwise keep assisting them directly.",
      };
    case "update_volunteer_status":
      return {
        status: "accepted_pending_integration",
        message:
          "The status update was authorized, but volunteer status storage is not connected yet.",
        requested_status: args.status,
      };
    case "create_internal_note":
      return {
        status: "accepted_pending_integration",
        message: "The note was authorized, but internal note storage is not connected yet.",
      };

    // --- Task Management Tools ---
    case "get_my_tasks": {
      const status = (args.status as string) ?? "all";
      const priority = (args.priority as string) ?? "all";
      const view = (args.view as string) ?? "list";
      const params = new URLSearchParams();
      if (status !== "all") params.set("status", status);
      if (priority !== "all") params.set("priority", priority);
      if (view === "kanban") {
        const board = await callInternalApi(`/api/tasks/kanban?${params.toString()}`, { phone: context.phoneE164 });
        return {
          board,
          board_url: `${getBaseUrl()}/admin/tasks`,
        };
      }
      return callInternalApi(`/api/tasks?${params.toString()}`, { phone: context.phoneE164 });
    }
    case "get_task_detail": {
      const query = args.query as string;
      // Check if it looks like a UUID
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(query);
      if (isUuid) {
        return callInternalApi(`/api/tasks/${query}`, { phone: context.phoneE164 });
      }
      // Keyword search - get all tasks and filter
      const tasks = await callInternalApi("/api/tasks", { phone: context.phoneE164 }) as Array<{ title: string; description: string }>;
      if (Array.isArray(tasks)) {
        const lowerQuery = query.toLowerCase();
        const matched = tasks.filter((t) =>
          t.title?.toLowerCase().includes(lowerQuery) ||
          t.description?.toLowerCase().includes(lowerQuery)
        );
        return matched.length > 0 ? matched.slice(0, 5) : { message: "No tasks found matching that query." };
      }
      return tasks;
    }
    case "get_department_summary": {
      const deptName = args.department_name as string;
      // First resolve department name to ID
      const depts = await callInternalApi("/api/departments", { phone: context.phoneE164 }) as Array<{ id: string; name: string }>;
      if (!Array.isArray(depts)) return { error: "Could not fetch departments" };
      const dept = depts.find((d) => d.name.toLowerCase() === deptName.toLowerCase());
      if (!dept) return { error: `Department not found: ${deptName}` };
      return callInternalApi(`/api/departments/${dept.id}/summary`, { phone: context.phoneE164 });
    }
    case "update_task_status": {
      return callInternalApi(`/api/tasks/${args.task_id}`, {
        method: "PUT",
        phone: context.phoneE164,
        body: { status: args.status, priority: args.priority, note: args.note },
      });
    }
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
    case "assign_task": {
      return callInternalApi(`/api/tasks/${args.task_id}`, {
        method: "PUT",
        phone: context.phoneE164,
        body: { assigned_to_alias: args.assign_to_alias },
      });
    }
    case "get_top_blockers": {
      const params = new URLSearchParams();
      const deptName = typeof args.department_name === "string" ? args.department_name : undefined;
      if (deptName) {
        const depts = await callInternalApi("/api/departments", { phone: context.phoneE164 }) as Array<{ id: string; name: string }>;
        if (!Array.isArray(depts)) return { error: "Could not fetch departments" };
        const dept = depts.find((d) => d.name.toLowerCase() === deptName.toLowerCase());
        if (!dept) return { error: `Department not found: ${deptName}` };
        params.set("department_id", dept.id);
      }
      const tasks = await callInternalApi(`/api/tasks?${params.toString()}`, { phone: context.phoneE164 }) as Array<{
        id: string;
        title: string;
        status: string;
        priority?: string | null;
        due_date?: string | null;
        updated_at?: string | null;
      }>;
      if (!Array.isArray(tasks)) return tasks;
      const today = new Date().toISOString().split("T")[0];
      const limit = typeof args.limit === "number" && args.limit > 0 ? Math.min(args.limit, 20) : 5;
      const weight = (priority: string | null | undefined) => priority === "high" ? 3 : priority === "medium" ? 2 : priority === "low" ? 1 : 0;
      return tasks
        .filter((task) => task.status === "blocked" || (Boolean(task.due_date) && task.due_date! < today && task.status !== "complete"))
        .sort((a, b) => {
          const priorityDiff = weight(b.priority) - weight(a.priority);
          if (priorityDiff !== 0) return priorityDiff;
          return new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime();
        })
        .slice(0, limit);
    }
    case "get_all_departments_summary": {
      const filter = (args.filter as string) ?? "all";
      return callInternalApi(`/api/departments/summary/all?filter=${filter}`, { phone: context.phoneE164 });
    }
    case "get_department_tasks": {
      const deptName = args.department_name as string;
      const depts = await callInternalApi("/api/departments", { phone: context.phoneE164 }) as Array<{ id: string; name: string }>;
      if (!Array.isArray(depts)) return { error: "Could not fetch departments" };
      const dept = depts.find((d) => d.name.toLowerCase() === deptName.toLowerCase());
      if (!dept) return { error: `Department not found: ${deptName}` };
      const status = (args.status as string) ?? "all";
      const params = new URLSearchParams();
      if (status !== "all") params.set("status", status);
      return callInternalApi(`/api/departments/${dept.id}/tasks?${params.toString()}`, { phone: context.phoneE164 });
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
