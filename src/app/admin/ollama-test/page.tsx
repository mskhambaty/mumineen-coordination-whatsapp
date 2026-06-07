"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { readAdminUser } from "@/lib/admin/client";

type OllamaModel = {
  name: string;
  model?: string;
  modified_at?: string;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type CompletionResult = {
  content: string;
  model: string;
  latencyMs: number;
};

type OllamaModelsResponse = {
  models?: unknown;
  data?: unknown;
};

function toOllamaModel(value: unknown): OllamaModel | null {
  if (!value || typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name : "";
  const model = typeof record.model === "string" ? record.model : undefined;
  const id = typeof record.id === "string" ? record.id : undefined;
  const modifiedAt = typeof record.modified_at === "string" ? record.modified_at : undefined;
  const resolvedName = name || model || id;

  if (!resolvedName) return null;

  return {
    name: resolvedName,
    model: model ?? id,
    modified_at: modifiedAt,
  };
}

function parseOllamaModels(data: OllamaModelsResponse): OllamaModel[] {
  const rawModels = Array.isArray(data.models)
    ? data.models
    : Array.isArray(data.data)
      ? data.data
      : [];

  return rawModels
    .map(toOllamaModel)
    .filter((model: OllamaModel | null): model is OllamaModel => model !== null);
}

export default function OllamaTestPage() {
  const router = useRouter();
  const [ollamaApiKey, setOllamaApiKey] = useState("");
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [includeOpenAI, setIncludeOpenAI] = useState(true);

  const [ollamaResult, setOllamaResult] = useState<CompletionResult | null>(null);
  const [openaiResult, setOpenaiResult] = useState<CompletionResult | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);

  useEffect(() => {
    const user = readAdminUser();
    if (!user) {
      router.push("/admin/login");
      return;
    }
    if (!isAdminOrLeadership(user)) {
      router.push("/admin/tasks");
    }
  }, [router]);

  async function fetchModels() {
    if (!ollamaApiKey.trim()) {
      setModelsError("Enter an Ollama API key first");
      return;
    }
    setModelsLoading(true);
    setModelsError(null);
    try {
      const res = await fetch("/api/ollama/models", {
        headers: { "x-ollama-api-key": ollamaApiKey },
      });
      const data = (await res.json()) as OllamaModelsResponse & { error?: string };
      if (!res.ok) {
        setModelsError(data.error ?? "Failed to fetch models");
        return;
      }
      const modelList = parseOllamaModels(data);
      setModels(modelList);
      if (modelList.length > 0 && !selectedModel) {
        setSelectedModel(modelList[0].model ?? modelList[0].name);
      }
    } catch (err) {
      setModelsError(err instanceof Error ? err.message : "Network error");
    } finally {
      setModelsLoading(false);
    }
  }

  async function sendMessage() {
    if (!input.trim() || !selectedModel || !ollamaApiKey) return;

    const userMsg: ChatMessage = { role: "user", content: input.trim() };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInput("");
    setSending(true);
    setChatError(null);
    setOllamaResult(null);
    setOpenaiResult(null);

    try {
      const res = await fetch("/api/ollama/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: updatedMessages.map((m) => ({ role: m.role, content: m.content })),
          ollamaApiKey,
          ollamaModel: selectedModel,
          includeOpenAI,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setChatError(data.error ?? "Chat request failed");
        return;
      }

      if (data.error) {
        setChatError(data.error);
      }

      if (data.ollama) {
        setOllamaResult(data.ollama);
        if (data.ollama.content) {
          setMessages((prev) => [...prev, { role: "assistant", content: `[Ollama/${selectedModel}] ${data.ollama.content}` }]);
        }
      }
      if (data.openai) {
        setOpenaiResult(data.openai);
      }
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSending(false);
    }
  }

  function clearChat() {
    setMessages([]);
    setOllamaResult(null);
    setOpenaiResult(null);
    setChatError(null);
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold">Ollama A/B Test</h1>
      <p className="mb-6 text-sm text-gray-600 dark:text-gray-400">
        Compare Ollama cloud models against OpenAI using the same system prompt and parameters as the live agent.
      </p>

      {/* Configuration */}
      <section className="mb-6 rounded-lg border bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <h2 className="mb-4 text-lg font-semibold">Configuration</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium">Ollama API Key</label>
            <input
              type="password"
              value={ollamaApiKey}
              onChange={(e) => setOllamaApiKey(e.target.value)}
              placeholder="Enter your Ollama API key"
              className="w-full rounded-md border px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Model</label>
            <div className="flex gap-2">
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="flex-1 rounded-md border px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"
              >
                {models.length === 0 && <option value="">-- Load models first --</option>}
                {models.map((m) => (
                  <option key={m.model ?? m.name} value={m.model ?? m.name}>
                    {m.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={fetchModels}
                disabled={modelsLoading}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {modelsLoading ? "Loading..." : "Load Models"}
              </button>
            </div>
            {modelsError && <p className="mt-1 text-xs text-red-500">{modelsError}</p>}
          </div>
        </div>
        <div className="mt-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeOpenAI}
              onChange={(e) => setIncludeOpenAI(e.target.checked)}
              className="rounded"
            />
            Include OpenAI response for A/B comparison
          </label>
        </div>
      </section>

      {/* Chat */}
      <section className="mb-6 rounded-lg border bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Chat</h2>
          <button
            type="button"
            onClick={clearChat}
            className="rounded-md border px-3 py-1 text-sm text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            Clear
          </button>
        </div>

        {/* Message history */}
        <div className="mb-4 max-h-80 overflow-y-auto rounded-md border bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800">
          {messages.length === 0 && (
            <p className="text-center text-sm text-gray-400">No messages yet. Send a message below.</p>
          )}
          {messages.map((msg, idx) => (
            <div
              key={idx}
              className={`mb-2 rounded-md px-3 py-2 text-sm ${
                msg.role === "user"
                  ? "ml-8 bg-blue-100 text-blue-900 dark:bg-blue-900/30 dark:text-blue-200"
                  : "mr-8 bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-200"
              }`}
            >
              <span className="font-medium">{msg.role === "user" ? "You" : "Assistant"}:</span>{" "}
              {msg.content}
            </div>
          ))}
          {sending && (
            <div className="text-center text-sm text-gray-400">Generating response...</div>
          )}
        </div>

        {/* Input */}
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendMessage(); } }}
            placeholder="Type a message..."
            className="flex-1 rounded-md border px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"
            disabled={sending || !selectedModel}
          />
          <button
            type="button"
            onClick={() => void sendMessage()}
            disabled={sending || !input.trim() || !selectedModel}
            className="rounded-md bg-green-600 px-4 py-2 text-sm text-white hover:bg-green-700 disabled:opacity-50"
          >
            Send
          </button>
        </div>
        {chatError && <p className="mt-2 text-xs text-red-500">{chatError}</p>}
      </section>

      {/* A/B Results */}
      {(ollamaResult || openaiResult) && (
        <section className="rounded-lg border bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <h2 className="mb-4 text-lg font-semibold">A/B Comparison (Latest)</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {/* Ollama result */}
            <div className="rounded-md border p-4 dark:border-gray-700">
              <h3 className="mb-2 font-medium text-purple-600 dark:text-purple-400">
                Ollama — {ollamaResult?.model}
              </h3>
              <p className="mb-1 text-xs text-gray-500">
                Latency: {ollamaResult?.latencyMs ?? 0}ms
              </p>
              <p className="whitespace-pre-wrap text-sm">
                {ollamaResult?.content || <span className="italic text-gray-400">No response</span>}
              </p>
            </div>

            {/* OpenAI result */}
            {openaiResult && (
              <div className="rounded-md border p-4 dark:border-gray-700">
                <h3 className="mb-2 font-medium text-green-600 dark:text-green-400">
                  OpenAI — {openaiResult.model}
                </h3>
                <p className="mb-1 text-xs text-gray-500">
                  Latency: {openaiResult.latencyMs}ms
                </p>
                <p className="whitespace-pre-wrap text-sm">
                  {openaiResult.content || <span className="italic text-gray-400">No response</span>}
                </p>
              </div>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
