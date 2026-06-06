import OpenAI from "openai";

import { requireEnv } from "@/lib/env";

// Single source of truth for all LLM configuration.
// All files that call OpenAI MUST import from here.
export const AI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
// Higher-end model used only for Waaz Talaqi / Lisan answers (where accuracy + tone matter
// most). Falls back to AI_MODEL when OPENAI_MODEL_HIGH isn't set, so it's a no-op until configured.
export const AI_MODEL_HIGH = process.env.OPENAI_MODEL_HIGH || AI_MODEL;
// Reading images needs a vision-capable model. Kept separate from AI_MODEL so a
// non-vision OPENAI_MODEL override can't silently break image understanding.
export const AI_VISION_MODEL = process.env.OPENAI_VISION_MODEL ?? "gpt-4o-mini";
export const AI_EMBEDDING_MODEL = "text-embedding-3-small";

export const AGENT_TEMPERATURE = 0.2;
export const PARSE_TEMPERATURE = 0.1;
export const SUMMARY_TEMPERATURE = 0.4;

export const MAX_AGENT_TOKENS = 1024;
export const MAX_PARSE_TOKENS = 4096;
export const MAX_SUMMARY_TOKENS = 2048;

// GPT-5.x and o-series are reasoning models: they reject a custom `temperature` (only the
// default is allowed) and reject the deprecated `max_tokens` parameter — they require
// `max_completion_tokens`. Sending the old params returns a 400 "Unsupported parameter" error.
export function isReasoningModel(model: string): boolean {
  return /^(gpt-5|o\d)/i.test(model);
}

// Build the model-specific chat-completion parameters so a model swap stays a pure env-var
// change and never a code change. `max_completion_tokens` is used for ALL models (gpt-4o*
// accept it too), and `temperature` is only attached for models that allow a custom value.
// Spread the result into a chat.completions.create() call alongside messages/tools/etc.
export function chatParams(
  model: string,
  tuning: { maxTokens: number; temperature?: number },
): {
  model: string;
  max_completion_tokens: number;
  temperature?: number;
  reasoning_effort?: "minimal" | "low" | "medium" | "high";
} {
  const reasoning = isReasoningModel(model);
  const params: {
    model: string;
    max_completion_tokens: number;
    temperature?: number;
    reasoning_effort?: "minimal" | "low" | "medium" | "high";
  } = {
    model,
    max_completion_tokens: tuning.maxTokens,
  };
  if (tuning.temperature !== undefined && !reasoning) {
    params.temperature = tuning.temperature;
  }
  // Reasoning models default to heavier reasoning, which (a) makes each WhatsApp reply slow
  // enough to risk the function timeout and (b) spends much of `max_completion_tokens` on hidden
  // reasoning, leaving little/no budget for the visible answer (→ empty reply). `low` keeps
  // these short, grounded RAG answers fast and ensures real visible output.
  if (reasoning) {
    params.reasoning_effort = "low";
  }
  return params;
}

let client: OpenAI | null = null;

export function getAIClient(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: requireEnv("OPENAI_API_KEY") });
  }

  return client;
}
