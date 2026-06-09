"use client";

import { useEffect, useRef } from "react";
import type { Message } from "./types";

type Props = {
  messages: Message[];
};

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function ConversationThread({ messages }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Sort ascending by created_at
  const sorted = [...messages].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (sorted.length === 0) {
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--triage-text-muted)",
          fontSize: "14px",
        }}
      >
        No messages
      </div>
    );
  }

  return (
    <div
      style={{
        flex: 1,
        overflowY: "auto",
        padding: "16px",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
      }}
    >
      {sorted.map((msg) => {
        const isOutbound = msg.direction === "outbound";
        const hasBody = msg.body && msg.body.trim().length > 0;
        const isImage = msg.message_type === "image";

        return (
          <div
            key={msg.id}
            style={{
              display: "flex",
              justifyContent: isOutbound ? "flex-end" : "flex-start",
            }}
          >
            <div
              style={{
                maxWidth: "75%",
                background: isOutbound
                  ? "var(--triage-accent)"
                  : "var(--triage-surface-raised)",
                color: isOutbound ? "#ffffff" : "var(--triage-text)",
                borderRadius: "12px",
                padding: "8px 12px",
              }}
            >
              {/* Body */}
              {hasBody ? (
                <p
                  style={{
                    margin: 0,
                    fontSize: "14px",
                    lineHeight: "1.6",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {msg.body}
                </p>
              ) : isImage ? (
                <p
                  style={{
                    margin: 0,
                    fontSize: "14px",
                    lineHeight: "1.6",
                    fontStyle: "italic",
                    opacity: isOutbound ? 0.85 : 1,
                  }}
                >
                  [Image]
                </p>
              ) : (
                <p
                  style={{
                    margin: 0,
                    fontSize: "14px",
                    lineHeight: "1.6",
                    fontStyle: "italic",
                    opacity: isOutbound ? 0.85 : 1,
                  }}
                >
                  [Image]
                </p>
              )}

              {/* Timestamp */}
              <p
                style={{
                  margin: "4px 0 0",
                  fontSize: "11px",
                  textAlign: "right",
                  color: isOutbound
                    ? "rgba(255,255,255,0.7)"
                    : "var(--triage-text-muted)",
                }}
              >
                {formatTimestamp(msg.created_at)}
              </p>
            </div>
          </div>
        );
      })}

      {/* Bottom anchor for auto-scroll */}
      <div ref={bottomRef} />
    </div>
  );
}
