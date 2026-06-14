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

const indexedSiteStatus = {
  availability: "active",
  status_label: "Indexed FAQs",
  status_note: "Backed by curated FAQ docs and per-department FAQ buckets in the site_content vector store.",
} satisfies Pick<ToolMetadata, "availability" | "status_label" | "status_note">;

const toolMetadata: Record<string, ToolMetadata> = {
  get_site_content_faq: {
    internal_api: "Vector search: site_content",
    audience: "external",
    ...indexedSiteStatus,
  },
  answer_religious_questions: {
    internal_api: "Vector search: religious_content",
    audience: "external",
    availability: "active",
    status_label: "Religious content",
    status_note:
      "Backed by the dedicated religious_content vector store (Vaaz Talaqi, Iqtibasaat, Tazyeen topic blocks + uploads).",
  },
  get_lisan_word_meaning: {
    internal_api: "Exact lookup: lisan_words (+ pg_trgm did-you-mean)",
    audience: "external",
    availability: "active",
    status_label: "Lisan dictionary",
    status_note:
      "Exact word lookup over the lisan_words table with fuzzy 'did you mean' suggestions; populated from the uploaded dictionary CSV.",
  },
  get_family_meal_rsvps: {
    internal_api: "GET /api/rsvp/meals",
    audience: "external",
    ...activeApiStatus,
  },
  set_family_meal_rsvps: {
    internal_api: "POST /api/rsvp/meals",
    audience: "external",
    ...activeApiStatus,
  },
  move_to_escalation: {
    internal_api: "POST /api/escalations",
    audience: "external",
    ...activeApiStatus,
  },
  report_lost_item: {
    internal_api: "POST /api/lost-found",
    audience: "external",
    ...activeApiStatus,
  },
  report_found_item: {
    internal_api: "POST /api/lost-found",
    audience: "external",
    ...activeApiStatus,
  },
  list_tasks: {
    internal_api: "GET /api/tasks",
    audience: "internal",
    ...activeApiStatus,
  },
  list_departments: {
    internal_api: "GET /api/departments",
    audience: "internal",
    ...activeApiStatus,
  },
  list_department_members: {
    internal_api: "GET /api/departments/:id/members",
    audience: "internal",
    ...activeApiStatus,
  },
  update_tasks: {
    internal_api: "GET /api/tasks + PUT /api/tasks/:id",
    audience: "internal",
    ...activeApiStatus,
  },
  create_task: {
    internal_api: "POST /api/tasks",
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
