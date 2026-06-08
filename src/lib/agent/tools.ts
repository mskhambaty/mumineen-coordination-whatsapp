import type OpenAI from "openai";

import { canUseTool, canUseTaskToolForCaller, publicTools, committeeTools, taskReadTools, taskWriteTools, taskCreateTools, leadershipTools, type AppUser } from "@/lib/permissions";
import { retrieveReligiousContext, retrieveSiteContext } from "@/lib/scraper/retrieve-site-context";
import { lookupLisanWord } from "@/lib/knowledge/lisan-words";
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
    if (committeeTools.has(name)) return user.role === "committee" || user.role === "admin";
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
      name: "flag_knowledge_gap",
      description:
        "Log a knowledge gap when you genuinely CANNOT answer a visitor's INFORMATIONAL question because the topic isn't covered in get_site_content_faq (or any source available to you) — so the team can publish the info. Call this IN ADDITION to telling the user the details aren't available yet. Do NOT use it for: questions you can already answer; concrete problems to fix (use create_issue); human hand-offs, accommodation/utaro, or visa requests (use move_to_escalation or the relevant form). One call per distinct topic.",
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
        "Get the caller's family's current jaman (meal) RSVP grid for Ashara — every lunch (thaal) and dinner (packets) day, with whether the family is down as attending and the head count. Use this to show the user what you already have on file before confirming or changing it, and to see which days are still unanswered. RSVP is tracked for the whole family.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "set_family_meal_rsvps",
      description:
        "Record or update the caller's family's jaman (meal) RSVP. Use when the user tells you which days/meals they will attend and how many. Always confirm the parsed result back to the user. Each entry sets one meal (lunch or dinner) for either specific dates or ALL days of that meal (omit dates or set all=true). Examples: 'lunch all days, 5 of us' -> {meal:'lunch', attending:true, head_count:5, all:true}; 'no dinners' -> {meal:'dinner', attending:false, all:true}; 'lunch on the 16th and 17th, 3 people' -> {meal:'lunch', attending:true, head_count:3, dates:['2026-06-16','2026-06-17']}. RSVP applies to the whole family.",
      parameters: {
        type: "object",
        properties: {
          entries: {
            type: "array",
            description: "One or more meal instructions to apply.",
            items: {
              type: "object",
              properties: {
                meal: { type: "string", enum: ["lunch", "dinner"], description: "Which meal." },
                attending: { type: "boolean", description: "true if the family will attend this meal, false if not." },
                head_count: { type: "number", description: "Number of family members attending this meal (omit when not attending)." },
                dates: {
                  type: "array",
                  items: { type: "string", description: "A date in YYYY-MM-DD." },
                  description: "Specific days to apply to. Omit to apply to every day of this meal.",
                },
                all: { type: "boolean", description: "Set true to apply to every day of this meal (same as omitting dates)." },
              },
              required: ["meal", "attending"],
              additionalProperties: false,
            },
          },
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

async function flagKnowledgeGap(topic: string, question: string | null, phone: string) {
  const result = await recordKnowledgeGap(topic, question, phone);
  return { ...result, topic };
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
    case "answer_religious_questions": {
      const query = String(args.query ?? "Ashara majlis Vaaz Talaqi Iqtibasaat");
      const today = new Date().toISOString().slice(0, 10);
      // Resolve "this year / today / last year / 1447" to a concrete event year (removes the
      // 1447↔1448 ambiguity). cue "none" → fall back to the most recent COMPLETED Ashara.
      const yr = resolveAsharaYear(query, today);
      const renderHits = (hits: { title: string; content: string; source_url: string | null; theme?: string | null }[]) =>
        hits.map((t) => `[${t.title}${t.source_url ? ` — Source: ${t.source_url}` : ""}]\n${t.theme ? `Theme: ${t.theme}\n` : ""}${t.content}`).join("\n\n---\n\n");

      // 1. Specific majlis ("Majlis 2", "second waaz", "4th Muharram") → exact block(s).
      // (Checked FIRST so a broad-phrasing overview query can't hijack a specific majlis.
      // Structured lookup also beats vector search, which mis-ranks majlis ordinals.)
      const ref = parseMajlisRef(query);
      if (ref) {
        // Year precedence: explicit/relative resolver → in-query year → null (most recent).
        const targetYear = yr.year ?? ref.year ?? null;
        const targetRef = { ...ref, year: targetYear };
        const hits = await findMajlisForRef(targetRef);
        if (hits.length) {
          const hitYear = hits[0].year_hijri ?? targetYear ?? null;
          const facets = await availableFacets({ ...ref, year: hitYear });
          return {
            status: "ok",
            source: "religious_topic_exact",
            answer_style: isDeepQuery(query) ? "deep" : "brief",
            year: hitYear ?? undefined,
            available_facets: facets,
            context: renderHits(hits),
          };
        }
        // Not available for the requested year — is it available for the last completed year?
        const requestedYear = targetYear ?? ACTIVE_ASHARA_YEAR;
        if (requestedYear !== LAST_COMPLETED_ASHARA_YEAR) {
          const altRef = { ...ref, year: LAST_COMPLETED_ASHARA_YEAR };
          const altHits = await findMajlisForRef(altRef);
          if (altHits.length) {
            const facets = await availableFacets(altRef);
            return {
              status: "not_available",
              answer_style: isDeepQuery(query) ? "deep" : "brief",
              requested_year: requestedYear,
              available_year: LAST_COMPLETED_ASHARA_YEAR,
              available_facets: facets,
              context: `Ashara ${requestedYear}H has not taken place yet / is not posted. Tell the user that plainly, then answer from last year (Ashara ${LAST_COMPLETED_ASHARA_YEAR}H), clearly labelled as that year:\n\n` + renderHits(altHits),
            };
          }
        }
        return {
          status: "not_available",
          answer_style: "brief",
          year: requestedYear,
          available_facets: [],
          context: `No indexed content for that majlis in Ashara ${requestedYear}H yet.`,
        };
      }

      // 2. Overview intent ("what was last year/the whole Ashara about", "topics of all
      // majalis") → the curated year-level overview block + the per-majlis theme list.
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
        if (ctx) return { status: "ok", source: "religious_overview", answer_style: "overview", year, context: ctx };
        const altCtx = year !== LAST_COMPLETED_ASHARA_YEAR ? await overviewCtx(LAST_COMPLETED_ASHARA_YEAR) : "";
        if (altCtx) {
          return {
            status: "not_available", answer_style: "overview", requested_year: year, available_year: LAST_COMPLETED_ASHARA_YEAR,
            context: `Ashara ${year}H has not taken place yet / is not posted. Tell the user that, then give last year's (Ashara ${LAST_COMPLETED_ASHARA_YEAR}H):\n\n` + altCtx,
          };
        }
        return { status: "not_available", answer_style: "overview", year, context: `No indexed overview for Ashara ${year}H yet.` };
      }

      // 3. General religious question → category-aware vector fallback. A decoration question
      // searches tazyeen; everything else searches the sermon sources (reflection + al_dars +
      // overview) so the decoration article never answers a sermon-content question.
      const decoration = /\b(tazyeen|tazeen|tazyin|decorat|sajawat|sajaawat|artwork|calligraph)\b/i.test(query);
      const cats = decoration ? ["tazyeen"] : ["reflection", "al_dars", "overview"];
      return getIndexedInfo(
        query,
        "I could not find this in the indexed religious content yet.",
        (qy, k) => retrieveReligiousContext(qy, k, cats),
        "indexed_religious_content",
      );
    }
    case "get_lisan_word_meaning":
      return lookupLisanWord(String(args.word ?? ""));
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
    case "flag_knowledge_gap":
      return flagKnowledgeGap(String(args.topic ?? "").trim(), args.question != null ? String(args.question) : null, context.phoneE164);
    case "get_family_meal_rsvps":
      return callInternalApi("/api/rsvp/meals", { phone: context.phoneE164 });
    case "set_family_meal_rsvps":
      return callInternalApi("/api/rsvp/meals", {
        method: "POST",
        phone: context.phoneE164,
        body: { entries: args.entries ?? [] },
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
