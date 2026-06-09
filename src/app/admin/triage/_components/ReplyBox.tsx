"use client";

import { useRef, useState } from "react";
import { apiFetch } from "@/lib/admin/client";

type Props = {
  phone: string;
  onSent: () => void;
};

export function ReplyBox({ phone, onSent }: Props) {
  const [body, setBody] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const canSend = (body.trim().length > 0 || attachment !== null) && !sending;

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setAttachment(file);
    // Reset so same file can be re-selected after removing
    e.target.value = "";
  }

  function removeAttachment() {
    setAttachment(null);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (canSend) void handleSend();
    }
  }

  // Auto-grow textarea
  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
    setBody(el.value);
  }

  async function handleSend() {
    if (!canSend) return;
    setSending(true);
    setError(null);

    try {
      let res: Response;

      if (attachment) {
        const fd = new FormData();
        fd.append("to", phone);
        if (body.trim()) fd.append("body", body.trim());
        fd.append("file", attachment);
        res = await apiFetch("/api/admin/conversations/reply", {
          method: "POST",
          body: fd,
        });
      } else {
        res = await apiFetch("/api/admin/conversations/reply", {
          method: "POST",
          body: JSON.stringify({ to: phone, body: body.trim() }),
        });
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error ?? "Failed to send");
        return;
      }

      // Reset state on success
      setBody("");
      setAttachment(null);
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
      onSent();
    } catch {
      setError("Network error");
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      style={{
        background: "var(--triage-surface)",
        borderTop: "1px solid var(--triage-border)",
        padding: "12px 16px",
        flexShrink: 0,
      }}
    >
      {/* Attachment bar */}
      {attachment && (
        <div
          style={{
            background: "var(--triage-surface-raised)",
            borderRadius: "6px",
            padding: "6px 10px",
            marginBottom: "8px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "8px",
            fontSize: "12px",
            color: "var(--triage-text-secondary)",
          }}
        >
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
            }}
          >
            {attachment.name}
          </span>
          <button
            type="button"
            onClick={removeAttachment}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--triage-text-muted)",
              fontSize: "12px",
              padding: "0 2px",
              flexShrink: 0,
              lineHeight: 1,
            }}
            aria-label="Remove attachment"
          >
            ✕
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <p
          style={{
            fontSize: "12px",
            color: "var(--triage-pending)",
            margin: "0 0 8px",
          }}
        >
          {error}
        </p>
      )}

      {/* Input row */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: "8px",
        }}
      >
        {/* Attach button */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          aria-label="Attach image"
          style={{
            background: "transparent",
            border: "1px solid var(--triage-border)",
            color: "var(--triage-text-muted)",
            borderRadius: "8px",
            padding: "7px 9px",
            cursor: "pointer",
            flexShrink: 0,
            lineHeight: 0,
            transition: "background 0.15s ease, border-color 0.15s ease",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background =
              "var(--triage-surface-raised)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background =
              "transparent";
          }}
        >
          {/* Paperclip SVG */}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </button>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={handleFileChange}
        />

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          rows={1}
          value={body}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder="Type a WhatsApp reply"
          style={{
            flex: 1,
            background: "var(--triage-surface-raised)",
            border: "1px solid var(--triage-border)",
            color: "var(--triage-text)",
            borderRadius: "8px",
            padding: "8px 12px",
            fontSize: "14px",
            lineHeight: "1.5",
            outline: "none",
            resize: "none",
            overflowY: "hidden",
            fontFamily: "inherit",
            maxHeight: "160px",
            overflowX: "hidden",
          }}
        />

        {/* Send button */}
        <button
          type="button"
          disabled={!canSend}
          onClick={() => void handleSend()}
          style={{
            background: "var(--triage-accent)",
            color: "#ffffff",
            border: "none",
            borderRadius: "8px",
            padding: "8px 16px",
            fontSize: "14px",
            fontWeight: 500,
            cursor: canSend ? "pointer" : "not-allowed",
            opacity: canSend ? 1 : 0.5,
            flexShrink: 0,
            transition: "background 0.15s ease, opacity 0.15s ease",
            whiteSpace: "nowrap",
          }}
          onMouseEnter={(e) => {
            if (canSend)
              (e.currentTarget as HTMLButtonElement).style.background =
                "var(--triage-accent-hover)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background =
              "var(--triage-accent)";
          }}
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}
