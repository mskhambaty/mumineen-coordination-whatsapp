import type OpenAI from "openai";

import { canUseTool, canUseTaskTool, type AppUser, type GlobalRole } from "@/lib/permissions";
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
      name: "get_event_schedule",
      description: "Get public Ashara Mubarak 1447H schedule information.",
      parameters: {
        type: "object",
        properties: {
          day: { type: "string", description: "Optional day or date the user asked about." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_parking_info",
      description: "Get public parking guidance for event visitors.",
      parameters: {
        type: "object",
        properties: {
          location: { type: "string", description: "Optional parking area or venue hint." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_directions",
      description: "Get public directions guidance.",
      parameters: {
        type: "object",
        properties: {
          from: { type: "string", description: "Optional starting point." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_faq_answer",
      description: "Answer public event FAQ questions.",
      parameters: {
        type: "object",
        properties: {
          question: { type: "string", description: "The user's question." },
        },
        required: ["question"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_lost_found_info",
      description: "Get public lost and found guidance.",
      parameters: {
        type: "object",
        properties: {},
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
      description: "Get tasks assigned to the caller or in their departments.",
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["open", "in_progress", "blocked", "complete", "all"],
            description: "Filter by status. Defaults to all.",
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
        },
        required: ["task_id", "status"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_task",
      description: "Create a new task. Requires PM, HOD, or Leadership/Admin role.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Task title." },
          department_name: { type: "string", description: "Department name." },
          description: { type: "string", description: "Task description." },
          assigned_to_alias: { type: "string", description: "Name of person to assign." },
          due_date: { type: "string", description: "Due date in YYYY-MM-DD format." },
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
];

export async function executeTool(name: string, args: ToolInput, context: ToolContext) {
  const allowed = canUseTool(context.user, name);

  if (!allowed) {
    const restricted = {
      error:
        "This action is restricted to authorized committee members. Please contact the admin team if you believe you should have access.",
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

  // Additional permission check for task tools
  const globalRole = context.callerContext?.global_role ?? "member";
  if (!canUseTaskTool(globalRole as GlobalRole, name) && isTaskTool(name)) {
    const restricted = {
      error: `This action requires ${getRequiredRole(name)} role. Your current role is: ${globalRole}`,
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
    "update_task_status", "create_task", "assign_task",
    "get_all_departments_summary", "get_department_tasks",
  ].includes(name);
}

function getRequiredRole(name: string): string {
  if (["get_all_departments_summary", "get_department_tasks"].includes(name)) {
    return "leadership_admin";
  }
  if (["update_task_status", "create_task", "assign_task"].includes(name)) {
    return "pm, hod, or leadership_admin";
  }
  return "any authenticated user";
}

function getBaseUrl(): string {
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

async function runTool(name: string, args: ToolInput, context: ToolContext) {
  switch (name) {
    case "get_event_schedule":
      return {
        status: "not_published",
        message:
          "The detailed Ashara Mubarak 1447H event schedule has not been published in this assistant yet. Please check official Anjuman announcements for confirmed timings.",
        day: args.day ?? null,
      };
    case "get_parking_info":
      return {
        status: "not_published",
        message:
          "Parking guidance is not available in this assistant yet. Please follow official parking announcements and on-site volunteer directions.",
        location: args.location ?? null,
      };
    case "get_directions":
      return {
        status: "not_published",
        message:
          "Venue directions have not been configured in this assistant yet. Please check official Anjuman communication for the confirmed venue address.",
        from: args.from ?? null,
      };
    case "get_faq_answer":
      return {
        status: "not_published",
        question: args.question,
        message:
          "That FAQ answer has not been added yet. I can help once the event operations team publishes the confirmed information.",
      };
    case "get_lost_found_info":
      return {
        status: "not_published",
        message:
          "Lost and found procedures have not been published in this assistant yet. Please contact an on-site volunteer or check official announcements.",
      };
    case "get_volunteer_assignment":
      return {
        status: "not_connected",
        message:
          "Volunteer assignments are permission-protected, but the assignment source is not connected yet.",
        phone_e164: args.phone_e164 ?? context.phoneE164,
      };
    case "lookup_committee_contact":
      return {
        status: "not_connected",
        committee: args.committee,
        message: "The internal committee directory is not connected yet.",
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
      const params = new URLSearchParams();
      if (status !== "all") params.set("status", status);
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
        body: { status: args.status, note: args.note },
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
