import { NextRequest, NextResponse } from "next/server";

import { Ollama } from "ollama";

import { AGENT_TEMPERATURE, AI_MODEL, chatParams, getAIClient, MAX_AGENT_TOKENS } from "@/lib/ai/model";
import { loadAgentSystemPrompt } from "@/lib/agent/prompts";

export const runtime = "nodejs";

// Ollama cloud host for the official ollama client.
const OLLAMA_BASE_URL = "https://api.ollama.com";

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type RequestBody = {
  messages: ChatMessage[];
  ollamaApiKey?: string;
  ollamaModel?: string;
  includeOpenAI?: boolean;
};

/**
 * POST /api/ollama/chat
 * Sends a chat completion to Ollama cloud (and optionally OpenAI for A/B comparison).
 * Uses the same system prompt and parameters as the main agent loop.
 */
export async function POST(req: NextRequest) {
  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { messages, ollamaApiKey, ollamaModel, includeOpenAI } = body;

  if (!ollamaApiKey) {
    return NextResponse.json({ error: "Missing ollamaApiKey" }, { status: 400 });
  }
  if (!ollamaModel) {
    return NextResponse.json({ error: "Missing ollamaModel" }, { status: 400 });
  }
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "Missing or empty messages array" }, { status: 400 });
  }

  // Load the same system prompt used by the live agent
  const systemPrompt = await loadAgentSystemPrompt();

  const fullMessages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...messages,
  ];

  const results: {
    ollama?: { content: string; model: string; latencyMs: number };
    openai?: { content: string; model: string; latencyMs: number };
    error?: string;
  } = {};

  // --- Ollama completion ---
  try {
    const ollamaClient = new Ollama({
      host: OLLAMA_BASE_URL,
      headers: {
        Authorization: "Bearer " + ollamaApiKey,
      },
    });

    const start = Date.now();
    const ollamaResponse = await ollamaClient.chat({
      model: ollamaModel,
      messages: fullMessages,
      options: {
        temperature: AGENT_TEMPERATURE,
        num_predict: MAX_AGENT_TOKENS,
      },
    });
    const latencyMs = Date.now() - start;
    const ollamaContent =
      typeof ollamaResponse.message?.content === "string"
        ? ollamaResponse.message.content.trim()
        : "";

    results.ollama = {
      content: ollamaContent,
      model: ollamaModel,
      latencyMs,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    results.ollama = { content: "", model: ollamaModel, latencyMs: 0 };
    results.error = `Ollama error: ${message}`;
  }

  // --- Optional OpenAI comparison ---
  if (includeOpenAI) {
    try {
      const openaiClient = getAIClient();
      const start = Date.now();
      const openaiResponse = await openaiClient.chat.completions.create({
        ...chatParams(AI_MODEL, { maxTokens: MAX_AGENT_TOKENS, temperature: AGENT_TEMPERATURE }),
        messages: fullMessages,
      });
      const latencyMs = Date.now() - start;

      results.openai = {
        content: openaiResponse.choices[0]?.message?.content?.trim() ?? "",
        model: AI_MODEL,
        latencyMs,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      results.openai = { content: "", model: AI_MODEL, latencyMs: 0 };
      results.error = (results.error ? results.error + "; " : "") + `OpenAI error: ${message}`;
    }
  }

  return NextResponse.json(results);
}
