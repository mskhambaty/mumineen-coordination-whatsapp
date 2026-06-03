# Ollama A/B Testing

## Overview

Admin-only test page that lets you compare Ollama cloud model responses against OpenAI using the same system prompt and agent parameters. This enables cost/quality evaluation of open-source models as potential alternatives to OpenAI.

## How It Works

1. Admin enters an Ollama API key in the test page.
2. Available models are fetched from the Ollama cloud API (`https://ollama.com/api/models`).
3. Admin selects a model and types a test message.
4. The backend sends the message (with the live agent system prompt) to both Ollama cloud and optionally OpenAI.
5. Responses are displayed side-by-side with latency metrics for comparison.

## Architecture

```
Admin Page (/admin/ollama-test)
    │
    ├─ GET /api/ollama/models      → proxies model list from Ollama cloud
    │
    └─ POST /api/ollama/chat       → sends chat to Ollama (OpenAI-compatible endpoint)
                                     optionally also sends to OpenAI for A/B comparison
```

## API Routes

### GET /api/ollama/models

Fetches available models from Ollama cloud.

**Headers:**
- `x-ollama-api-key` (required): Ollama API key

**Response:** JSON with a `models` array of available models.

### POST /api/ollama/chat

Sends a chat completion request to Ollama cloud and optionally OpenAI.

**Request body:**
```json
{
  "messages": [{ "role": "user", "content": "Hello" }],
  "ollamaApiKey": "...",
  "ollamaModel": "llama3.1",
  "includeOpenAI": true
}
```

**Response:**
```json
{
  "ollama": { "content": "...", "model": "llama3.1", "latencyMs": 1200 },
  "openai": { "content": "...", "model": "gpt-4o-mini", "latencyMs": 800 }
}
```

## Configuration

- Ollama API key is provided per-session in the browser (not stored server-side).
- The Ollama cloud endpoint uses the OpenAI-compatible API at `https://api.ollama.com/v1`.
- The same `AGENT_TEMPERATURE`, `MAX_AGENT_TOKENS`, and system prompt are used for both providers.
- OpenAI comparison requires the existing `OPENAI_API_KEY` env var.

## Key Files

```
src/app/admin/ollama-test/page.tsx       — Admin test page UI
src/app/api/ollama/models/route.ts       — Model list API route
src/app/api/ollama/chat/route.ts         — Chat completion API route
```

## Access Control

The test page is restricted to admin/leadership users (same gate as other admin pages).
