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

let client: OpenAI | null = null;

export function getAIClient(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: requireEnv("OPENAI_API_KEY") });
  }

  return client;
}
