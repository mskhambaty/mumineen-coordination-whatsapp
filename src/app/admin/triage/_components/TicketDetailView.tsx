"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/admin/client";
import type {
  ActivityEntry,
  Department,
  DeptContact,
  LinkedTask,
  Message,
  Ticket,
  ToolCall,
} from "./types";
import { ActionBar } from "./ActionBar";
import { ActivityTimeline } from "./ActivityTimeline";
import { ConversationThread } from "./ConversationThread";
import { DepartmentContactsPanel } from "./DepartmentContactsPanel";
import { LinkedTasksPanel } from "./LinkedTasksPanel";
import { ReplyBox } from "./ReplyBox";
import { ToolCallsPanel } from "./ToolCallsPanel";
import { UserProfilePanel } from "./UserProfilePanel";

// ── Types ─────────────────────────────────────────────────────────────────────

type ProfileData = {
  registration_status: string | null;
  member_count: number;
  local_or_outstation: string | null;
  city: string | null;
  jamaat: string | null;
};

type Props = {
  ticket: Ticket;
  departments: Department[];
  onBack: () => void;
  onAction: () => void;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function maskPhone(phone: string): string {
  // Keep last 4 characters, replace preceding digits with *
  return phone.replace(/\d(?=\d{4})/g, "*");
}

function minsUntilDeadline(deadline: string): number {
  return Math.floor((new Date(deadline).getTime() - Date.now()) / 60000);
}

function SlaCountdown({ deadline }: { deadline: string }) {
  const minsLeft = minsUntilDeadline(deadline);
  const breached = minsLeft < 0;
  const warn = !breached && minsLeft < 30;

  const color = breached
    ? "var(--triage-sla-breach)"
    : warn
      ? "var(--triage-sla-warn)"
      : "var(--triage-sla-ok)";

  const label = breached
    ? `Breached ${Math.abs(minsLeft)}m ago`
    : `${minsLeft}m left`;

  return (
    <span
      style={{
        fontSize: "12px",
        fontWeight: 600,
        color,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function TicketDetailView({
  ticket,
  departments,
  onBack,
  onAction,
}: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [linkedTasks, setLinkedTasks] = useState<LinkedTask[]>([]);
  const [deptContacts, setDeptContacts] = useState<DeptContact[]>([]);
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [currentTicket, setCurrentTicket] = useState(ticket);

  const encodedPhone = encodeURIComponent(currentTicket.phone_e164);

  async function refreshAll() {
    const [convRes, actRes, tasksRes, profileRes] = await Promise.all([
      apiFetch(
        `/api/admin/conversations?phone=${encodedPhone}&limit=1`,
      ),
      apiFetch(`/api/admin/escalations/${encodedPhone}/activity`),
      apiFetch(`/api/admin/escalations/${encodedPhone}/tasks`),
      apiFetch(`/api/admin/conversations/${encodedPhone}/profile`),
    ]);

    // Messages + tool calls + ticket state update
    if (convRes.ok) {
      const convData = (await convRes.json()) as {
        conversations: Array<{
          messages: Message[];
          tool_calls: ToolCall[];
          escalation_status?: string;
          escalation_priority?: string;
          escalation_category?: string;
          escalation_assigned_to?: string;
          linked_task_id?: string | null;
          linked_task_title?: string | null;
          linked_task_status?: string | null;
          linked_task_department?: string | null;
        }>;
      };
      const conv = convData.conversations?.[0];
      if (conv) {
        setMessages(conv.messages ?? []);
        setToolCalls(conv.tool_calls ?? []);
        // Update ticket fields that may have changed via actions
        setCurrentTicket((prev) => ({
          ...prev,
          escalation_stage: (conv.escalation_status as Ticket["escalation_stage"]) ?? prev.escalation_stage,
          escalation_priority: conv.escalation_priority ?? prev.escalation_priority,
          escalation_category: conv.escalation_category ?? prev.escalation_category,
          escalation_assigned_to: conv.escalation_assigned_to ?? prev.escalation_assigned_to,
          linked_task_id: conv.linked_task_id ?? prev.linked_task_id,
          linked_task_title: conv.linked_task_title ?? prev.linked_task_title,
          linked_task_status: conv.linked_task_status ?? prev.linked_task_status,
          linked_task_department: conv.linked_task_department ?? prev.linked_task_department,
        }));
      }
    }

    // Activity
    if (actRes.ok) {
      const actData = (await actRes.json()) as { activities: ActivityEntry[] };
      setActivities(actData.activities ?? []);
    }

    // Tasks
    if (tasksRes.ok) {
      const tasksData = (await tasksRes.json()) as { tasks: LinkedTask[] };
      setLinkedTasks(tasksData.tasks ?? []);
    }

    // Profile
    setProfileLoading(true);
    if (profileRes.ok) {
      const profileData = (await profileRes.json()) as {
        profile: {
          registration_status: string | null;
          member_count: number;
          member: {
            local_mehman: string | null;
            city: string | null;
            jamaat: string | null;
          } | null;
        } | null;
      };
      const p = profileData.profile;
      setProfile(
        p
          ? {
              registration_status: p.registration_status,
              member_count: p.member_count,
              local_or_outstation: p.member?.local_mehman ?? null,
              city: p.member?.city ?? null,
              jamaat: p.member?.jamaat ?? null,
            }
          : null,
      );
    }
    setProfileLoading(false);
  }

  // Fetch department contacts when stage is waiting_on_department
  useEffect(() => {
    if (currentTicket.escalation_stage !== "waiting_on_department") return;
    if (!currentTicket.linked_task_department) return;

    const dept = departments.find(
      (d) => d.name === currentTicket.linked_task_department,
    );
    if (!dept) return;

    apiFetch(`/api/admin/departments/${encodeURIComponent(dept.id)}/contacts`)
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as {
          reference_contacts: DeptContact[];
          member_contacts: Array<{
            name: string | null;
            email: string | null;
            phone: string | null;
            dept_role: string | null;
          }>;
        };
        // Merge both contact sources into DeptContact shape
        const refContacts: DeptContact[] = data.reference_contacts ?? [];
        const memberContacts: DeptContact[] = (data.member_contacts ?? []).map(
          (mc) => ({
            name: mc.name ?? "",
            role: mc.dept_role,
            phone_e164: mc.phone,
            email: mc.email,
            notes: null,
          }),
        );
        setDeptContacts([...refContacts, ...memberContacts]);
      })
      .catch(() => undefined);
  }, [
    currentTicket.escalation_stage,
    currentTicket.linked_task_department,
    departments,
  ]);

  // Initial data load
  useEffect(() => {
    async function load() {
      await refreshAll();
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleAction() {
    void refreshAll();
    onAction();
  }

  const showDeptContacts =
    currentTicket.escalation_stage === "waiting_on_department" &&
    deptContacts.length > 0;

  return (
    <div
      className="triage-detail-enter"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* ── Top Bar ──────────────────────────────────────────────────────────── */}
      <div
        className="triage-glass"
        style={{
          flexShrink: 0,
          position: "sticky",
          top: 0,
          zIndex: 10,
          borderBottom: "1px solid var(--triage-border)",
          padding: "10px 16px",
          display: "flex",
          alignItems: "center",
          gap: "12px",
          flexWrap: "wrap",
        }}
      >
        {/* Back button */}
        <button
          type="button"
          onClick={onBack}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "4px",
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--triage-text-muted)",
            fontSize: "13px",
            fontWeight: 500,
            padding: "4px 0",
            transition: "color 0.15s ease",
            flexShrink: 0,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color =
              "var(--triage-text)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color =
              "var(--triage-text-muted)";
          }}
          aria-label="Back to board"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M9 2L4 7L9 12"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Back
        </button>

        {/* Vertical divider */}
        <div
          aria-hidden="true"
          style={{
            width: "1px",
            height: "20px",
            background: "var(--triage-border)",
            flexShrink: 0,
          }}
        />

        {/* Display name */}
        <span
          className="triage-heading"
          style={{
            fontSize: "14px",
            fontWeight: 600,
            color: "var(--triage-text)",
            whiteSpace: "nowrap",
          }}
        >
          {currentTicket.display_name ?? "Unknown"}
        </span>

        {/* Masked phone */}
        <span
          className="triage-mono"
          style={{
            fontSize: "12px",
            color: "var(--triage-text-muted)",
            whiteSpace: "nowrap",
          }}
        >
          {maskPhone(currentTicket.phone_e164)}
        </span>

        {/* Priority badge */}
        <span
          className={
            currentTicket.escalation_priority === "urgent"
              ? "triage-badge-urgent"
              : "triage-badge-normal"
          }
          style={{
            padding: "2px 8px",
            borderRadius: "9999px",
            fontSize: "11px",
            fontWeight: 600,
            textTransform: "capitalize",
            whiteSpace: "nowrap",
          }}
        >
          {currentTicket.escalation_priority}
        </span>

        {/* Category badge */}
        {currentTicket.escalation_category && (
          <span
            style={{
              background: "var(--triage-claimed-bg)",
              color: "var(--triage-claimed)",
              padding: "2px 8px",
              borderRadius: "9999px",
              fontSize: "11px",
              fontWeight: 600,
              whiteSpace: "nowrap",
            }}
          >
            {currentTicket.escalation_category}
          </span>
        )}

        {/* SLA countdown */}
        {currentTicket.escalation_sla_deadline && (
          <SlaCountdown deadline={currentTicket.escalation_sla_deadline} />
        )}

        {/* Action bar — pushed to the right */}
        <div style={{ marginLeft: "auto" }}>
          <ActionBar
            phone={currentTicket.phone_e164}
            stage={currentTicket.escalation_stage}
            departments={departments}
            onAction={handleAction}
          />
        </div>
      </div>

      {/* ── Two-column layout ─────────────────────────────────────────────────── */}
      <div
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: "3fr 2fr",
          overflow: "hidden",
          minHeight: 0,
        }}
      >
        {/* ── Left column: conversation + reply ─────────────────────────────── */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            borderRight: "1px solid var(--triage-border-subtle)",
          }}
        >
          <ConversationThread messages={messages} />
          <ReplyBox
            phone={currentTicket.phone_e164}
            onSent={() => void refreshAll()}
          />
        </div>

        {/* ── Right column: panels ──────────────────────────────────────────── */}
        <div
          style={{
            overflowY: "auto",
            padding: "16px",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
          }}
        >
          {/* 1. Activity Timeline — always shown */}
          <div style={{ animationDelay: "0ms" }}>
            <ActivityTimeline activities={activities} />
          </div>

          {/* 2. Department Contacts — only when waiting and contacts exist */}
          {showDeptContacts && (
            <div
              className="triage-panel-enter"
              style={{ animationDelay: "50ms" }}
            >
              <DepartmentContactsPanel
                departmentName={currentTicket.linked_task_department ?? null}
                contacts={deptContacts}
              />
            </div>
          )}

          {/* 3. User Profile Panel */}
          <div
            className="triage-panel-enter"
            style={{ animationDelay: showDeptContacts ? "100ms" : "50ms" }}
          >
            <UserProfilePanel profile={profile} loading={profileLoading} />
          </div>

          {/* 4. Linked Tasks Panel */}
          <div
            className="triage-panel-enter"
            style={{
              animationDelay: showDeptContacts ? "150ms" : "100ms",
            }}
          >
            <LinkedTasksPanel tasks={linkedTasks} loading={false} />
          </div>

          {/* 5. Tool Calls Panel */}
          <div
            className="triage-panel-enter"
            style={{
              animationDelay: showDeptContacts ? "200ms" : "150ms",
            }}
          >
            <ToolCallsPanel toolCalls={toolCalls} />
          </div>
        </div>
      </div>
    </div>
  );
}
