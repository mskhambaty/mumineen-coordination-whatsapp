// Curated subset of agent tools that mumineen actually trigger in a conversation, surfaced in the
// audience builder's "AI tool usage" filter (used / didn't use within N hours). Admin/task tools
// (list_tasks, create_task, get_milestones, update_milestone, list_departments, …) are intentionally
// omitted — mumineen don't invoke them, so they'd only clutter the dropdown. `name` must match the
// tool name in run-agent's tool definitions (tools.ts); `label` is the friendly dropdown text.
// Keep in sync with tools.ts when adding/removing a mumineen-facing tool.
export const FILTERABLE_AGENT_TOOLS: { name: string; label: string }[] = [
  { name: "get_site_content_faq", label: "FAQ / site content lookup" },
  { name: "answer_religious_questions", label: "Religious Q&A (Waaz Talaqqi)" },
  { name: "get_lisan_word_meaning", label: "Lisan word meaning" },
  { name: "report_lost_item", label: "Reported a lost item" },
  { name: "report_found_item", label: "Reported a found item" },
  { name: "move_to_escalation", label: "Escalated to support" },
  { name: "flag_knowledge_gap", label: "Flagged a knowledge gap" },
  { name: "get_family_meal_rsvps", label: "Checked meal RSVP" },
  { name: "set_family_meal_rsvps", label: "Updated meal RSVP" },
];
