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

// Always-on escalation guidance, appended to whatever system prompt is loaded so
// it can't be edited away. The hard turn-gate lives server-side in /api/escalations.
const ESCALATION_POLICY = `\n\n## Escalation Policy (last resort)
You can answer almost every visitor question yourself using get_site_content_faq. Handing a conversation to a human via move_to_escalation is a LAST RESORT.
- Always try to understand the request and answer it with get_site_content_faq first.
- Never escalate just because the user asks for a person, especially early in the chat. First ask what they need and genuinely try to help; only escalate if you still cannot.
- Escalate only when: you genuinely cannot help after trying; the user is clearly frustrated after you have tried; or there is an emergency (lost child, lost passport, medical, security). For emergencies set priority to 'urgent' immediately.
- After a successful escalation the system confirms to the user that the team has been notified, so keep your closing reply brief.`;

// Always-on greeting style so the agent doesn't re-greet on every message.
const GREETING_RULE = `\n\n## Greeting Style
- When you greet, the greeting must be exactly "Salaam un Jameel" — do not use other salaam variations.
- Greet only ONCE per conversation. The full message history is provided; if you (the assistant) have already greeted earlier in this conversation, do NOT greet again. Reply directly to the user's message without any salaam.`;

// Always-on rule: the agent must never leave a user with "no help available".
const NO_DEAD_END_RULE = `\n\n## Never Leave the User Without Help
- NEVER tell the user that support, live help, a contact, or any service is "unavailable", "not connected", or that no one can assist. Internal tool statuses such as "not_connected" or "not_published" are for you only — never repeat them to the user.
- Do NOT deflect the user to "official channels", committee contacts, or "official announcements / the official site" as a way to avoid helping, and never offer to guide them on how to reach the committee. These are not substitutes for helping and may expose private committee information.
- If the user asks to talk to a person or wants live support, treat it as a human request: briefly confirm what they need, then use move_to_escalation so a team member reaches out.
- If you cannot resolve their need yourself, either escalate with move_to_escalation (someone will follow up) or use create_issue to log it for the internal team — then reassure the user it has been passed on and someone will get back to them.
- Always leave the user with a clear next step (you'll keep helping, or the team has been notified), never a dead end.`;

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

  systemContent += ESCALATION_POLICY;
  systemContent += GREETING_RULE;
  systemContent += NO_DEAD_END_RULE;

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

  let escalationAck: string | null = null;

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

    if (toolCall.function.name === "move_to_escalation" && isEscalated(toolResult)) {
      escalationAck = escalationAcknowledgment(toolResult);
    }

    messages.push({
      role: "tool",
      tool_call_id: toolCall.id,
      content: JSON.stringify(toolResult),
    });
  }

  // On a successful escalation, reply with a deterministic acknowledgment and skip
  // the second completion. A 'declined' guardrail result falls through so the model
  // keeps assisting normally.
  if (escalationAck) {
    return escalationAck;
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

function isEscalated(result: unknown): result is { status: string; priority?: string } {
  return (
    typeof result === "object" &&
    result !== null &&
    (result as { status?: unknown }).status === "escalated"
  );
}

function escalationAcknowledgment(result: { priority?: string }): string {
  if (result.priority === "urgent") {
    return "I understand this is urgent. I've alerted our support team right away — someone will reach out to you as soon as possible. Please keep this number reachable.";
  }
  return "I've passed this on to our support team, and someone will follow up with you shortly. Is there anything else I can help you with in the meantime?";
}

function fallbackReply() {
  return "I am sorry, I could not produce a reliable answer just now. Please check official Anjuman announcements or try again shortly.";
}
