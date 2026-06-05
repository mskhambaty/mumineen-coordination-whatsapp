"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { isAdminOrLeadership } from "@/lib/admin/access";

type TemplateDescriptor = {
  name: string;
  language: string;
  category: string | null;
  bodyText: string | null;
  bodyVarCount: number;
  header: { format: string; hasVar: boolean } | null;
  urlButtons: { index: number; text: string | null; hasVar: boolean }[];
};

const inputCls =
  "block w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-950";

function preview(bodyText: string | null, params: string[]): string {
  if (!bodyText) return "";
  return bodyText.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => params[Number(n) - 1] || `{{${n}}}`);
}

export default function WhatsAppPage() {
  const router = useRouter();
  const adminKey = process.env.NEXT_PUBLIC_ADMIN_KEY ?? "";

  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<TemplateDescriptor[]>([]);

  const [recipient, setRecipient] = useState("");
  const [kind, setKind] = useState<"template" | "text">("template");
  const [text, setText] = useState("");

  const [tplName, setTplName] = useState("");
  const [bodyParams, setBodyParams] = useState<string[]>([]);
  const [headerText, setHeaderText] = useState("");
  const [headerMediaUrl, setHeaderMediaUrl] = useState("");
  const [urlButtonParam, setUrlButtonParam] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("admin_token");
    if (!token) {
      router.push("/admin/login");
      return;
    }
    const raw = localStorage.getItem("admin_user");
    const user = raw ? (JSON.parse(raw) as { role?: string; global_role?: string }) : null;
    if (!isAdminOrLeadership(user)) {
      router.push("/admin/conversations");
      return;
    }
    void loadTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function loadTemplates() {
    setTemplatesError(null);
    try {
      const res = await fetch("/api/admin/whatsapp/templates", { headers: { "x-admin-key": adminKey } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to load templates");
      setTemplates((data.templates as TemplateDescriptor[]) ?? []);
    } catch (err) {
      setTemplatesError(err instanceof Error ? err.message : "Failed to load templates");
    }
  }

  const selectedTpl = useMemo(() => templates.find((t) => t.name === tplName) ?? null, [templates, tplName]);
  const dynamicUrlBtn = selectedTpl?.urlButtons.find((b) => b.hasVar) ?? null;

  function selectTemplate(name: string) {
    setTplName(name);
    const t = templates.find((x) => x.name === name) ?? null;
    setBodyParams(t ? Array.from({ length: t.bodyVarCount }, () => "") : []);
    setHeaderText("");
    setHeaderMediaUrl("");
    setUrlButtonParam("");
  }

  async function send() {
    if (!recipient.trim()) {
      setError("Enter an ITS or phone number.");
      return;
    }
    setSending(true);
    setError(null);
    setResult(null);
    try {
      const payload =
        kind === "text"
          ? { its: recipient.trim(), kind, text }
          : {
              its: recipient.trim(),
              kind,
              template: {
                name: selectedTpl?.name,
                language: selectedTpl?.language,
                bodyParams,
                headerText: selectedTpl?.header?.format === "TEXT" ? headerText : undefined,
                headerMediaUrl: selectedTpl?.header && selectedTpl.header.format !== "TEXT" ? headerMediaUrl : undefined,
                urlButtonParam: dynamicUrlBtn ? urlButtonParam : undefined,
              },
            };
      if (kind === "template" && !selectedTpl) {
        setError("Pick a template.");
        setSending(false);
        return;
      }
      const res = await fetch("/api/admin/whatsapp/send", {
        method: "POST",
        headers: { "x-admin-key": adminKey, "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Send failed");
      setResult(`Sent ${kind === "template" ? `template "${data.template}"` : "message"} to ${data.name ?? data.to}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-5">
        <h1 className="text-xl font-bold">WhatsApp</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Send a template or a free-text message to one recipient.</p>
      </div>

      {error && <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{error}</div>}
      {result && <div className="mb-4 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300">{result}</div>}

      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <label className="block text-xs uppercase tracking-wide text-gray-400">Recipient (ITS or phone)
          <input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="40495151 or +1…" className={`${inputCls} mt-1 max-w-xs`} />
        </label>

        <div className="mt-4 flex gap-2">
          <button type="button" onClick={() => setKind("template")} className={`rounded-md px-3 py-1.5 text-sm font-medium ${kind === "template" ? "bg-blue-600 text-white" : "border border-gray-300 text-gray-700 dark:border-gray-700 dark:text-gray-200"}`}>Template</button>
          <button type="button" onClick={() => setKind("text")} className={`rounded-md px-3 py-1.5 text-sm font-medium ${kind === "text" ? "bg-blue-600 text-white" : "border border-gray-300 text-gray-700 dark:border-gray-700 dark:text-gray-200"}`}>Free text</button>
        </div>

        {kind === "template" ? (
          <div className="mt-4 space-y-3">
            {templatesError ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                Couldn’t load templates: {templatesError}
                <button type="button" onClick={loadTemplates} className="ml-2 underline">retry</button>
              </div>
            ) : (
              <label className="block text-xs uppercase tracking-wide text-gray-400">Template
                <select value={tplName} onChange={(e) => selectTemplate(e.target.value)} className={`${inputCls} mt-1`}>
                  <option value="">{templates.length ? "Select a template…" : "No approved templates"}</option>
                  {templates.map((t) => (
                    <option key={`${t.name}:${t.language}`} value={t.name}>{t.name} ({t.language}){t.category ? ` · ${t.category}` : ""}</option>
                  ))}
                </select>
              </label>
            )}

            {selectedTpl && (
              <>
                {selectedTpl.header?.format === "TEXT" && selectedTpl.header.hasVar && (
                  <label className="block text-xs uppercase tracking-wide text-gray-400">Header text
                    <input value={headerText} onChange={(e) => setHeaderText(e.target.value)} className={`${inputCls} mt-1`} />
                  </label>
                )}
                {selectedTpl.header && selectedTpl.header.format !== "TEXT" && (
                  <label className="block text-xs uppercase tracking-wide text-gray-400">Header media URL ({selectedTpl.header.format.toLowerCase()})
                    <input value={headerMediaUrl} onChange={(e) => setHeaderMediaUrl(e.target.value)} placeholder="https://…" className={`${inputCls} mt-1`} />
                  </label>
                )}
                {Array.from({ length: selectedTpl.bodyVarCount }).map((_, i) => (
                  <label key={i} className="block text-xs uppercase tracking-wide text-gray-400">Body variable {`{{${i + 1}}}`}
                    <input
                      value={bodyParams[i] ?? ""}
                      onChange={(e) => setBodyParams((p) => { const n = [...p]; n[i] = e.target.value; return n; })}
                      className={`${inputCls} mt-1`}
                    />
                  </label>
                ))}
                {dynamicUrlBtn && (
                  <label className="block text-xs uppercase tracking-wide text-gray-400">URL button value ({dynamicUrlBtn.text ?? "link"})
                    <input value={urlButtonParam} onChange={(e) => setUrlButtonParam(e.target.value)} className={`${inputCls} mt-1`} />
                  </label>
                )}
                {selectedTpl.bodyText && (
                  <div className="rounded-md border border-gray-100 bg-gray-50 p-3 text-sm dark:border-gray-800 dark:bg-gray-950">
                    <p className="mb-1 text-xs uppercase tracking-wide text-gray-400">Preview</p>
                    <p className="whitespace-pre-wrap">{preview(selectedTpl.bodyText, bodyParams)}</p>
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="mt-4">
            <label className="block text-xs uppercase tracking-wide text-gray-400">Message
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} className={`${inputCls} mt-1`} />
            </label>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Free text only delivers if the recipient messaged the bot in the last 24 hours. For cold outreach, use a template.</p>
          </div>
        )}

        <button type="button" onClick={send} disabled={sending} className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-700">
          {sending ? "Sending…" : "Send"}
        </button>
      </div>
    </main>
  );
}
