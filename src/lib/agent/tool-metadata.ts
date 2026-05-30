export type ToolAudience = "external" | "internal";
export type ToolAvailability = "active" | "setup_no_data" | "not_connected";

export type ToolMetadata = {
  internal_api: string;
  audience: ToolAudience;
  availability: ToolAvailability;
  status_label: string;
  status_note: string;
};

const activeApiStatus = {
  availability: "active",
  status_label: "Active",
  status_note: "API-backed and expected to return live data when matching records exist.",
} satisfies Pick<ToolMetadata, "availability" | "status_label" | "status_note">;

const toolMetadata: Record<string, ToolMetadata> = {
  get_event_schedule: {
    internal_api: "Static response (schedule not yet published)",
    audience: "external",
    availability: "setup_no_data",
    status_label: "Setup only",
    status_note: "Visible to external users, but the schedule has not been published in the assistant yet.",
  },
  get_parking_info: {
    internal_api: "Static response (parking info not yet published)",
    audience: "external",
    availability: "setup_no_data",
    status_label: "Setup only",
    status_note: "Visible to external users, but parking details are not configured yet.",
  },
  get_directions: {
    internal_api: "Static response (directions not yet published)",
    audience: "external",
    availability: "setup_no_data",
    status_label: "Setup only",
    status_note: "Visible to external users, but venue directions are not configured yet.",
  },
  get_faq_answer: {
    internal_api: "Static response (FAQ not yet published)",
    audience: "external",
    availability: "setup_no_data",
    status_label: "Setup only",
    status_note: "Visible to external users, but FAQ answers have not been added yet.",
  },
  get_lost_found_info: {
    internal_api: "Static response (lost & found not yet published)",
    audience: "external",
    availability: "setup_no_data",
    status_label: "Setup only",
    status_note: "Visible to external users, but lost and found guidance is not configured yet.",
  },
  get_volunteer_assignment: {
    internal_api: "Static response (volunteer system not connected)",
    audience: "internal",
    availability: "not_connected",
    status_label: "Not connected",
    status_note: "Permission-gated, but the volunteer assignment source is not connected yet.",
  },
  lookup_committee_contact: {
    internal_api: "Static response (directory not connected)",
    audience: "internal",
    availability: "not_connected",
    status_label: "Not connected",
    status_note: "Permission-gated, but the internal committee directory is not connected yet.",
  },
  update_volunteer_status: {
    internal_api: "Static response (pending integration)",
    audience: "internal",
    availability: "not_connected",
    status_label: "Pending integration",
    status_note: "Permission-gated and accepts the request shape, but no status storage is connected yet.",
  },
  create_internal_note: {
    internal_api: "Static response (pending integration)",
    audience: "internal",
    availability: "not_connected",
    status_label: "Pending integration",
    status_note: "Permission-gated and accepts the request shape, but no note storage is connected yet.",
  },
  get_my_tasks: {
    internal_api: "GET /api/tasks or GET /api/tasks/kanban",
    audience: "internal",
    ...activeApiStatus,
  },
  get_task_detail: {
    internal_api: "GET /api/tasks/:id or GET /api/tasks (keyword search)",
    audience: "internal",
    ...activeApiStatus,
  },
  get_department_summary: {
    internal_api: "GET /api/departments/:id/summary",
    audience: "internal",
    ...activeApiStatus,
  },
  update_task_status: {
    internal_api: "PUT /api/tasks/:id",
    audience: "internal",
    ...activeApiStatus,
  },
  create_task: {
    internal_api: "POST /api/tasks",
    audience: "internal",
    ...activeApiStatus,
  },
  assign_task: {
    internal_api: "PUT /api/tasks/:id",
    audience: "internal",
    ...activeApiStatus,
  },
  get_top_blockers: {
    internal_api: "GET /api/tasks (filtered by blocked/overdue)",
    audience: "internal",
    ...activeApiStatus,
  },
  get_all_departments_summary: {
    internal_api: "GET /api/departments/summary/all",
    audience: "internal",
    ...activeApiStatus,
  },
  get_department_tasks: {
    internal_api: "GET /api/departments/:id/tasks",
    audience: "internal",
    ...activeApiStatus,
  },
  get_milestones: {
    internal_api: "GET /api/milestones",
    audience: "internal",
    ...activeApiStatus,
  },
  update_milestone: {
    internal_api: "PUT /api/milestones/:id",
    audience: "internal",
    ...activeApiStatus,
  },
};

export function getToolApiMapping(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(toolMetadata).map(([name, metadata]) => [name, metadata.internal_api]),
  );
}

export function getToolMetadata(): Record<string, ToolMetadata> {
  return { ...toolMetadata };
}
