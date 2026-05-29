import type OpenAI from "openai";

import { canUseTool, type AppUser } from "@/lib/permissions";
import { recordToolAudit } from "@/lib/supabase/server";

type ToolInput = Record<string, unknown>;

type ToolContext = {
  user: AppUser;
  phoneE164: string;
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
