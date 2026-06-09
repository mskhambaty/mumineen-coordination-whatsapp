"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/admin/client";
import type { Department, EscalationStage } from "./types";

type Props = {
  phone: string;
  stage: EscalationStage;
  departments: Department[];
  onAction: () => void;
};

// ── Shared button styles ──────────────────────────────────────────────────────

const btnBase: React.CSSProperties = {
  borderRadius: "8px",
  padding: "6px 16px",
  fontSize: "14px",
  fontWeight: 500,
  cursor: "pointer",
  border: "none",
  transition: "background 0.15s ease, opacity 0.15s ease",
};

const btnPrimary: React.CSSProperties = {
  ...btnBase,
  background: "var(--triage-accent)",
  color: "#ffffff",
};

const btnViolet: React.CSSProperties = {
  ...btnBase,
  background: "var(--triage-waiting)",
  color: "#ffffff",
};

const btnGreen: React.CSSProperties = {
  ...btnBase,
  background: "var(--triage-resolved)",
  color: "#ffffff",
};

const btnOutline: React.CSSProperties = {
  ...btnBase,
  background: "transparent",
  border: "1px solid var(--triage-border)",
  color: "var(--triage-text-secondary)",
};

// ── Modal backdrop + card ─────────────────────────────────────────────────────

function ModalBackdrop({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--triage-surface)",
          border: "1px solid var(--triage-border)",
          borderRadius: "14px",
          boxShadow:
            "0 8px 25px -5px rgba(26,24,22,0.12), 0 4px 10px rgba(26,24,22,0.06)",
          width: "100%",
          maxWidth: "480px",
          padding: "24px",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--triage-surface-raised)",
  border: "1px solid var(--triage-border)",
  color: "var(--triage-text)",
  borderRadius: "8px",
  padding: "8px 12px",
  fontSize: "14px",
  outline: "none",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  color: "var(--triage-text-secondary)",
  fontSize: "14px",
  fontWeight: 500,
  display: "block",
  marginBottom: "6px",
};

const fieldStyle: React.CSSProperties = {
  marginBottom: "16px",
};

// ── CreateTaskModal ───────────────────────────────────────────────────────────

type CreateTaskModalProps = {
  phone: string;
  departments: Department[];
  onClose: () => void;
  onDone: () => void;
};

function CreateTaskModal({
  phone,
  departments,
  onClose,
  onDone,
}: CreateTaskModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high">(
    "medium",
  );
  const [departmentId, setDepartmentId] = useState(
    departments[0]?.id ?? "",
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(
        `/api/admin/escalations/${encodeURIComponent(phone)}/create-task`,
        {
          method: "POST",
          body: JSON.stringify({
            title: title.trim(),
            description: description.trim() || undefined,
            priority,
            department_id: departmentId || undefined,
          }),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(
          (data as { error?: string }).error ?? "Failed to create task",
        );
        return;
      }
      onDone();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <ModalBackdrop onClose={onClose}>
      <h2
        className="triage-heading"
        style={{ fontSize: "18px", marginBottom: "20px", color: "var(--triage-text)" }}
      >
        Create Task
      </h2>
      <form onSubmit={handleSubmit}>
        <div style={fieldStyle}>
          <label style={labelStyle}>Title *</label>
          <input
            style={inputStyle}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Brief summary of the issue"
            required
          />
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle}>Description</label>
          <textarea
            style={{ ...inputStyle, resize: "vertical", minHeight: "80px" }}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Additional details (optional)"
          />
        </div>

        <div style={{ display: "flex", gap: "12px", marginBottom: "16px" }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Priority</label>
            <select
              style={{ ...inputStyle, cursor: "pointer" }}
              value={priority}
              onChange={(e) =>
                setPriority(e.target.value as "low" | "medium" | "high")
              }
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>

          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Department</label>
            <select
              style={{ ...inputStyle, cursor: "pointer" }}
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
            >
              <option value="">— None —</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error && (
          <p
            style={{
              color: "var(--triage-pending)",
              fontSize: "13px",
              marginBottom: "12px",
            }}
          >
            {error}
          </p>
        )}

        <div
          style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}
        >
          <button
            type="button"
            onClick={onClose}
            style={btnOutline}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background =
                "var(--triage-surface-hover)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background =
                "transparent";
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading || !title.trim()}
            style={{
              ...btnViolet,
              opacity: loading || !title.trim() ? 0.6 : 1,
              cursor:
                loading || !title.trim() ? "not-allowed" : "pointer",
            }}
            onMouseEnter={(e) => {
              if (!loading && title.trim())
                (e.currentTarget as HTMLButtonElement).style.background =
                  "#6a4daa";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background =
                "var(--triage-waiting)";
            }}
          >
            {loading ? "Creating…" : "Create Task"}
          </button>
        </div>
      </form>
    </ModalBackdrop>
  );
}

// ── LinkTaskModal ─────────────────────────────────────────────────────────────

import type { LinkedTask } from "./types";

type LinkTaskModalProps = {
  phone: string;
  onClose: () => void;
  onDone: () => void;
};

function LinkTaskModal({ phone, onClose, onDone }: LinkTaskModalProps) {
  const [query, setQuery] = useState("");
  const [allTasks, setAllTasks] = useState<LinkedTask[]>([]);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [linking, setLinking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearching(true);
    setError(null);
    try {
      const res = await apiFetch(
        `/api/admin/escalations/${encodeURIComponent(phone)}/tasks`,
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(
          (data as { error?: string }).error ?? "Failed to fetch tasks",
        );
        return;
      }
      const data = (await res.json()) as { tasks: LinkedTask[] };
      setAllTasks(data.tasks ?? []);
      setSearched(true);
    } catch {
      setError("Network error");
    } finally {
      setSearching(false);
    }
  }

  const filteredTasks = allTasks.filter((t) => {
    if (t.status === "complete") return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return t.title.toLowerCase().includes(q);
  });

  async function handleLink(taskId: string) {
    setLinking(taskId);
    setError(null);
    try {
      const res = await apiFetch(
        `/api/admin/escalations/${encodeURIComponent(phone)}/link-task`,
        {
          method: "POST",
          body: JSON.stringify({ task_id: taskId }),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(
          (data as { error?: string }).error ?? "Failed to link task",
        );
        return;
      }
      onDone();
    } catch {
      setError("Network error");
    } finally {
      setLinking(null);
    }
  }

  return (
    <ModalBackdrop onClose={onClose}>
      <h2
        className="triage-heading"
        style={{ fontSize: "18px", marginBottom: "20px", color: "var(--triage-text)" }}
      >
        Link to Task
      </h2>

      <form onSubmit={handleSearch} style={{ marginBottom: "16px" }}>
        <div
          style={{ display: "flex", gap: "8px" }}
        >
          <input
            style={{ ...inputStyle, flex: 1 }}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tasks by title…"
          />
          <button
            type="submit"
            disabled={searching}
            style={{
              ...btnPrimary,
              opacity: searching ? 0.6 : 1,
              cursor: searching ? "not-allowed" : "pointer",
              whiteSpace: "nowrap",
            }}
            onMouseEnter={(e) => {
              if (!searching)
                (e.currentTarget as HTMLButtonElement).style.background =
                  "var(--triage-accent-hover)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background =
                "var(--triage-accent)";
            }}
          >
            {searching ? "Searching…" : "Search"}
          </button>
        </div>
      </form>

      {error && (
        <p
          style={{
            color: "var(--triage-pending)",
            fontSize: "13px",
            marginBottom: "12px",
          }}
        >
          {error}
        </p>
      )}

      {searched && (
        <div
          style={{
            border: "1px solid var(--triage-border)",
            borderRadius: "8px",
            overflow: "hidden",
            maxHeight: "280px",
            overflowY: "auto",
            marginBottom: "16px",
          }}
        >
          {filteredTasks.length === 0 ? (
            <p
              style={{
                padding: "16px",
                color: "var(--triage-text-muted)",
                fontSize: "13px",
                textAlign: "center",
              }}
            >
              No open tasks found.
            </p>
          ) : (
            filteredTasks.map((task) => (
              <div
                key={task.id}
                style={{
                  padding: "10px 14px",
                  borderBottom: "1px solid var(--triage-border)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "12px",
                  background: "var(--triage-surface)",
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <p
                    style={{
                      fontSize: "13px",
                      fontWeight: 500,
                      color: "var(--triage-text)",
                      margin: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {task.title}
                  </p>
                  <p
                    style={{
                      fontSize: "12px",
                      color: "var(--triage-text-muted)",
                      margin: "2px 0 0",
                    }}
                  >
                    {task.department_name ?? "No dept"} · {task.status} · {task.priority}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={linking === task.id}
                  onClick={() => handleLink(task.id)}
                  style={{
                    ...btnPrimary,
                    padding: "4px 12px",
                    fontSize: "13px",
                    opacity: linking === task.id ? 0.6 : 1,
                    cursor: linking === task.id ? "not-allowed" : "pointer",
                    flexShrink: 0,
                  }}
                  onMouseEnter={(e) => {
                    if (linking !== task.id)
                      (e.currentTarget as HTMLButtonElement).style.background =
                        "var(--triage-accent-hover)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background =
                      "var(--triage-accent)";
                  }}
                >
                  {linking === task.id ? "Linking…" : "Link"}
                </button>
              </div>
            ))
          )}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={onClose}
          style={btnOutline}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background =
              "var(--triage-surface-hover)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background =
              "transparent";
          }}
        >
          Close
        </button>
      </div>
    </ModalBackdrop>
  );
}

// ── ResolveModal ──────────────────────────────────────────────────────────────

type ResolveModalProps = {
  phone: string;
  onClose: () => void;
  onDone: () => void;
};

function ResolveModal({ phone, onClose, onDone }: ResolveModalProps) {
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(
        `/api/admin/escalations/${encodeURIComponent(phone)}/resolve`,
        {
          method: "POST",
          body: JSON.stringify({
            resolution_note: note.trim() || undefined,
          }),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(
          (data as { error?: string }).error ?? "Failed to resolve",
        );
        return;
      }
      onDone();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <ModalBackdrop onClose={onClose}>
      <h2
        className="triage-heading"
        style={{ fontSize: "18px", marginBottom: "8px", color: "var(--triage-text)" }}
      >
        Resolve Escalation
      </h2>
      <p
        style={{
          fontSize: "14px",
          color: "var(--triage-text-secondary)",
          marginBottom: "20px",
        }}
      >
        Mark this escalation as resolved. You can add an optional note.
      </p>

      <div style={fieldStyle}>
        <label style={labelStyle}>Resolution note (optional)</label>
        <textarea
          style={{ ...inputStyle, resize: "vertical", minHeight: "80px" }}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Describe how this was resolved…"
        />
      </div>

      {error && (
        <p
          style={{
            color: "var(--triage-pending)",
            fontSize: "13px",
            marginBottom: "12px",
          }}
        >
          {error}
        </p>
      )}

      <div
        style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}
      >
        <button
          type="button"
          onClick={onClose}
          style={btnOutline}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background =
              "var(--triage-surface-hover)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background =
              "transparent";
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={handleConfirm}
          style={{
            ...btnGreen,
            opacity: loading ? 0.6 : 1,
            cursor: loading ? "not-allowed" : "pointer",
          }}
          onMouseEnter={(e) => {
            if (!loading)
              (e.currentTarget as HTMLButtonElement).style.background =
                "#228a50";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background =
              "var(--triage-resolved)";
          }}
        >
          {loading ? "Resolving…" : "Confirm Resolve"}
        </button>
      </div>
    </ModalBackdrop>
  );
}

// ── ActionBar (main export) ───────────────────────────────────────────────────

type ModalState =
  | "none"
  | "create-task"
  | "link-task"
  | "resolve";

export function ActionBar({ phone, stage, departments, onAction }: Props) {
  const [modal, setModal] = useState<ModalState>("none");
  const [claiming, setClaiming] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  async function handleClaim() {
    setClaiming(true);
    setClaimError(null);
    try {
      const res = await apiFetch(
        `/api/admin/escalations/${encodeURIComponent(phone)}/claim`,
        { method: "POST" },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setClaimError(
          (data as { error?: string }).error ?? "Failed to claim",
        );
        return;
      }
      onAction();
    } catch {
      setClaimError("Network error");
    } finally {
      setClaiming(false);
    }
  }

  async function handleUnlinkTask() {
    setUnlinking(true);
    try {
      const res = await apiFetch(
        `/api/admin/escalations/${encodeURIComponent(phone)}/link-task`,
        { method: "DELETE" },
      );
      if (res.ok) {
        onAction();
      }
    } catch {
      // ignore
    } finally {
      setUnlinking(false);
    }
  }

  function closeModal() {
    setModal("none");
  }

  function completeAction() {
    setModal("none");
    onAction();
  }

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          flexWrap: "wrap",
        }}
      >
        {/* ── pending ── */}
        {stage === "pending" && (
          <>
            <button
              type="button"
              disabled={claiming}
              onClick={handleClaim}
              style={{
                ...btnPrimary,
                opacity: claiming ? 0.6 : 1,
                cursor: claiming ? "not-allowed" : "pointer",
              }}
              onMouseEnter={(e) => {
                if (!claiming)
                  (e.currentTarget as HTMLButtonElement).style.background =
                    "var(--triage-accent-hover)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background =
                  "var(--triage-accent)";
              }}
            >
              {claiming ? "Claiming…" : "Claim"}
            </button>
            {claimError && (
              <span
                style={{
                  fontSize: "12px",
                  color: "var(--triage-pending)",
                }}
              >
                {claimError}
              </span>
            )}
          </>
        )}

        {/* ── picked_up ── */}
        {stage === "picked_up" && (
          <>
            <button
              type="button"
              onClick={() => setModal("create-task")}
              style={btnViolet}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background =
                  "#6a4daa";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background =
                  "var(--triage-waiting)";
              }}
            >
              Create Task
            </button>

            <button
              type="button"
              onClick={() => setModal("link-task")}
              style={btnOutline}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background =
                  "var(--triage-surface-hover)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background =
                  "transparent";
              }}
            >
              Link to Task
            </button>

            <button
              type="button"
              onClick={() => setModal("resolve")}
              style={btnGreen}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background =
                  "#228a50";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background =
                  "var(--triage-resolved)";
              }}
            >
              Resolve
            </button>
          </>
        )}

        {/* ── waiting_on_department ── */}
        {stage === "waiting_on_department" && (
          <>
            <button
              type="button"
              disabled={unlinking}
              onClick={handleUnlinkTask}
              style={{
                ...btnOutline,
                opacity: unlinking ? 0.6 : 1,
                cursor: unlinking ? "not-allowed" : "pointer",
              }}
              onMouseEnter={(e) => {
                if (!unlinking)
                  (e.currentTarget as HTMLButtonElement).style.background =
                    "var(--triage-surface-hover)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background =
                  "transparent";
              }}
            >
              {unlinking ? "Unlinking…" : "Unlink Task"}
            </button>

            <button
              type="button"
              onClick={() => setModal("resolve")}
              style={btnGreen}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background =
                  "#228a50";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background =
                  "var(--triage-resolved)";
              }}
            >
              Resolve
            </button>
          </>
        )}
      </div>

      {/* ── Modals ── */}
      {modal === "create-task" && (
        <CreateTaskModal
          phone={phone}
          departments={departments}
          onClose={closeModal}
          onDone={completeAction}
        />
      )}

      {modal === "link-task" && (
        <LinkTaskModal
          phone={phone}
          onClose={closeModal}
          onDone={completeAction}
        />
      )}

      {modal === "resolve" && (
        <ResolveModal
          phone={phone}
          onClose={closeModal}
          onDone={completeAction}
        />
      )}
    </>
  );
}
