// src/app/admin/triage/_components/types.ts

export type EscalationStage = "none" | "pending" | "picked_up" | "waiting_on_department" | "resolved";

export type Ticket = {
  session_id: string;
  phone_e164: string;
  display_name: string;
  escalation_stage: EscalationStage;
  escalation_priority: string;
  escalation_category: string;
  escalation_reason: string | null;
  escalated_at: string | null;
  escalation_sla_deadline: string | null;
  escalation_assigned_to: string | null;
  assignee_name: string | null;
  linked_task_id: string | null;
  linked_task_title: string | null;
  linked_task_status: string | null;
  linked_task_department: string | null;
  last_inbound_message: string | null;
  message_count: number;
};

export type TeamMember = {
  user_id: string;
  display_name: string;
};

export type SLAStats = {
  open_count: number;
  pending_count: number;
  breaching_count: number;
  avg_pickup_minutes: number | null;
  resolved_today_count: number;
};

export type BoardData = {
  tickets: Ticket[];
  team_members: TeamMember[];
  sla_stats: SLAStats;
};

export type Message = {
  id: string;
  direction: "inbound" | "outbound";
  body: string | null;
  message_type: string | null;
  whatsapp_message_id: string | null;
  created_at: string;
  raw_payload: unknown;
};

export type ActivityEntry = {
  id: string;
  action: string;
  actor_label: string | null;
  details: Record<string, unknown>;
  created_at: string;
  task_id: string | null;
};

export type LinkedTask = {
  id: string;
  title: string;
  status: string;
  priority: string;
  department_name: string | null;
  created_at: string;
  is_linked: boolean;
  linked_conversation_count: number;
};

export type DeptContact = {
  name: string;
  role: string | null;
  phone_e164: string | null;
  email: string | null;
  notes: string | null;
};

export type ToolCall = {
  id: string;
  tool_name: string;
  arguments: unknown;
  allowed: boolean;
  result_summary: string | null;
  created_at: string;
};

export type Department = {
  id: string;
  name: string;
};

export type Filters = {
  assignee: string; // user_id, "all", or "unassigned"
  priority: string; // "all", "urgent", or "normal"
  category: string; // "all" or category name
  department: string; // "all" or department_id
};
