import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// The models listing endpoint differs from the OpenAI-compatible chat endpoint
// because Ollama serves its model registry from a separate domain.
const OLLAMA_MODELS_URL = "https://ollama.com/api/models";

/**
 * GET /api/ollama/models
 * Fetches available models from Ollama cloud.
 * Requires x-ollama-api-key header for authentication.
 */
export async function GET(req: NextRequest) {
  const apiKey = req.headers.get("x-ollama-api-key");
  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing x-ollama-api-key header" },
      { status: 400 },
    );
  }

  try {
    const response = await fetch(OLLAMA_MODELS_URL, {
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json(
        { error: `Ollama API error: ${response.status}`, details: text },
        { status: response.status },
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to fetch Ollama models", details: message },
      { status: 502 },
    );
  }
}
