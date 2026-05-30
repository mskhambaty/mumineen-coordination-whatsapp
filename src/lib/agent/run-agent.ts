import OpenAI from "openai";

import { executeTool, toolDefinitions } from "@/lib/agent/tools";
import { SYSTEM_PROMPT, loadAgentSystemPrompt } from "@/lib/agent/prompts";
import { AGENT_TEMPERATURE, AI_MODEL, getAIClient, MAX_AGENT_TOKENS } from "@/lib/ai/model";
import { resolveCallerFromPhone, type CallerContext } from "@/lib/api/auth";
import type { AppUser } from "@/lib/permissions";
import { retrieveSiteContext } from "@/lib/scraper/retrieve-site-context";
import { getRecentMessages } from "@/lib/supabase/server";

export { SYSTEM_PROMPT };

const HISTORY_MESSAGE_LIMIT = 12;
const MAX_HISTORY_CHARS = 2000;

type AgentInput = {
  user: AppUser;
  phoneE164: string;
  message: string;
  callerContext?: CallerContext;
};

export async function runAgent(input: AgentInput) {
  if (!input.message.trim()) {
    return "I received your message, but I cannot read that message type yet. Please send a text message and I will help.";
  }

  const client = getAIClient();

  // Resolve caller context, relevant site context, and conversation history
  // concurrently so the extra history read adds no sequential latency.
  const callerPromise: Promise<CallerContext | undefined> = input.callerContext
    ? Promise.resolve(input.callerContext)
    : resolveCallerFromPhone(input.phoneE164).catch(() => undefined);

  const [callerContext, siteContext, history, systemPromptText] = await Promise.all([
    callerPromise,
    retrieveSiteContext(input.message).catch((err) => {
      console.error("Failed to retrieve site context, continuing without it:", err);
      return "";
    }),
    getRecentMessages(input.phoneE164, HISTORY_MESSAGE_LIMIT).catch(() => []),
    loadAgentSystemPrompt(),
  ]);

  let systemContent = systemPromptText;
  if (siteContext) {
    systemContent += `\n\n## Current Site Information\nThe following is retrieved from the official Chicago Relay Center site (scraped daily):\n\n${siteContext}`;
  }

  // Sender + caller context belongs in the system prompt, not a user turn,
  // so the message history can replay cleanly as the conversation.
  systemContent += `\n\n## Sender Context\nPhone: ${input.phoneE164}\nBackend role: ${input.user.role}\nGlobal access: ${callerContext?.global_role ?? "unknown"}`;
  if (callerContext) {
    const deptNames = callerContext.departments.map((d) => `${d.department_name} (${d.dept_role})`).join(", ");
    systemContent += `\nDepartments: ${deptNames || "none"}\nCan read all: ${callerContext.can_read_all}\nCan write all: ${callerContext.can_write_all}`;
  }

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemContent },
  ];

  // The current inbound message is already persisted, so history ends with it.
  for (const turn of history) {
    const body = turn.body?.trim();
    if (!body) continue;
    messages.push({
      role: turn.direction === "outbound" ? "assistant" : "user",
      content: body.slice(0, MAX_HISTORY_CHARS),
    });
  }

  // Fallback: if history is empty (e.g. transient read failure), still answer
  // the current message so the agent never goes silent.
  if (messages.length === 1) {
    messages.push({ role: "user", content: input.message.slice(0, MAX_HISTORY_CHARS) });
  }

  const firstResponse = await client.chat.completions.create({
    model: AI_MODEL,
    messages,
    tools: toolDefinitions,
    tool_choice: "auto",
    temperature: AGENT_TEMPERATURE,
    max_tokens: MAX_AGENT_TOKENS,
  });

  const firstMessage = firstResponse.choices[0]?.message;

  if (!firstMessage?.tool_calls?.length) {
    return firstMessage?.content?.trim() || fallbackReply();
  }

  messages.push(firstMessage);

  for (const toolCall of firstMessage.tool_calls) {
    if (toolCall.type !== "function") {
      continue;
    }

    const args = parseToolArguments(toolCall.function.arguments);
    const toolResult = await executeTool(toolCall.function.name, args, {
      user: input.user,
      phoneE164: input.phoneE164,
      callerContext,
    });

    messages.push({
      role: "tool",
      tool_call_id: toolCall.id,
      content: JSON.stringify(toolResult),
    });
  }

  const finalResponse = await client.chat.completions.create({
    model: AI_MODEL,
    messages,
    temperature: AGENT_TEMPERATURE,
    max_tokens: MAX_AGENT_TOKENS,
  });

  return finalResponse.choices[0]?.message?.content?.trim() || fallbackReply();
}

function parseToolArguments(rawArguments: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(rawArguments);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function fallbackReply() {
  return "I am sorry, I could not produce a reliable answer just now. Please check official Anjuman announcements or try again shortly.";
}
