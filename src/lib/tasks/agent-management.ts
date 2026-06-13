import { z } from "zod";

export type AgentTask = {
  id: string;
  title: string;
  description?: string | null;
  status?: string | null;
  priority?: string | null;
  archived?: boolean | null;
  department_id?: string | null;
  departments?: { name?: string | null } | null;
};

export const taskSelectionSchema = z.object({
  task_ids: z.array(z.string().uuid()).max(50).optional(),
  query: z.string().trim().min(1).max(300).optional(),
  department_names: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  exclude_department_names: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  statuses: z.array(z.enum(["open", "in_progress", "blocked", "complete"])).max(4).optional(),
  priorities: z.array(z.enum(["low", "medium", "high"])).max(3).optional(),
  include_archived: z.boolean().optional(),
  all_matching: z.boolean().default(false),
});

export const taskUpdatesSchema = z.object({
  status: z.enum(["open", "in_progress", "blocked", "complete"]).optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  title: z.string().trim().min(1).max(300).optional(),
  description: z.string().max(10_000).optional(),
  clear_description: z.boolean().optional(),
  department_name: z.string().trim().min(1).max(100).optional(),
  assigned_to_name: z.string().trim().min(1).max(200).optional(),
  unassign: z.boolean().optional(),
  due_date: z.string().date().optional(),
  clear_due_date: z.boolean().optional(),
  item_type: z.enum(["task", "issue"]).optional(),
  archived: z.boolean().optional(),
}).superRefine((updates, ctx) => {
  if (updates.description !== undefined && updates.clear_description) {
    ctx.addIssue({ code: "custom", message: "Use description or clear_description, not both." });
  }
  if (updates.assigned_to_name !== undefined && updates.unassign) {
    ctx.addIssue({ code: "custom", message: "Use assigned_to_name or unassign, not both." });
  }
  if (updates.due_date !== undefined && updates.clear_due_date) {
    ctx.addIssue({ code: "custom", message: "Use due_date or clear_due_date, not both." });
  }
});

export const updateTasksInputSchema = z.object({
  selection: taskSelectionSchema,
  updates: taskUpdatesSchema,
});

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function queryMatches(task: AgentTask, query: string): boolean {
  const haystack = normalize(`${task.title} ${task.description ?? ""}`);
  const phrase = normalize(query);
  if (!phrase) return true;
  if (haystack.includes(phrase)) return true;

  const meaningfulTokens = phrase
    .split(" ")
    .filter((token) => token === "ai" || token.length >= 3)
    .filter((token) => !["all", "the", "and", "for", "related", "ticket", "tickets", "task", "tasks"].includes(token));
  const haystackTokens = new Set(haystack.split(" "));
  return meaningfulTokens.length > 0 && meaningfulTokens.some((token) => token === "ai" ? haystackTokens.has(token) : haystack.includes(token));
}

function departmentName(task: AgentTask): string {
  return normalize(task.departments?.name ?? "");
}

export function selectTasksForAgentUpdate(
  tasks: AgentTask[],
  rawSelection: unknown,
): { selected: AgentTask[]; error?: string } {
  const parsed = taskSelectionSchema.safeParse(rawSelection);
  if (!parsed.success) {
    return { selected: [], error: parsed.error.issues.map((issue) => issue.message).join("; ") };
  }

  const selection = parsed.data;
  const ids = new Set(selection.task_ids ?? []);
  const includedDepartments = new Set((selection.department_names ?? []).map(normalize));
  const excludedDepartments = new Set((selection.exclude_department_names ?? []).map(normalize));
  const statuses = new Set(selection.statuses ?? []);
  const priorities = new Set(selection.priorities ?? []);
  const hasSelector =
    ids.size > 0 ||
    Boolean(selection.query) ||
    includedDepartments.size > 0 ||
    excludedDepartments.size > 0 ||
    statuses.size > 0 ||
    priorities.size > 0;

  if (!hasSelector) {
    return { selected: [], error: "Select tickets by ID, query, department, status, priority, or exclusion before updating." };
  }

  const selected = tasks.filter((task) => {
    if (!selection.include_archived && task.archived) return false;
    if (ids.size > 0 && !ids.has(task.id)) return false;
    if (selection.query && !queryMatches(task, selection.query)) return false;
    if (includedDepartments.size > 0 && !includedDepartments.has(departmentName(task))) return false;
    if (excludedDepartments.has(departmentName(task))) return false;
    if (statuses.size > 0 && !statuses.has(task.status as "open" | "in_progress" | "blocked" | "complete")) return false;
    if (priorities.size > 0 && !priorities.has(task.priority as "low" | "medium" | "high")) return false;
    return true;
  });

  if (selected.length === 0) {
    return { selected: [], error: "No accessible tickets matched the selection." };
  }
  if (selected.length > 1 && !selection.all_matching) {
    return {
      selected: [],
      error: `The selection matched ${selected.length} tickets. Set all_matching=true only when the user explicitly asked to update every match.`,
    };
  }
  if (selected.length > 50) {
    return { selected: [], error: `The selection matched ${selected.length} tickets; the per-call limit is 50.` };
  }

  return { selected };
}

export function resolveUniqueName<T extends { id: string; name: string }>(
  items: T[],
  requestedName: string,
  label: string,
): { item?: T; error?: string } {
  const requested = normalize(requestedName);
  const exact = items.find((item) => normalize(item.name) === requested);
  if (exact) return { item: exact };

  const partial = items.filter((item) => normalize(item.name).includes(requested) || requested.includes(normalize(item.name)));
  if (partial.length === 1) return { item: partial[0] };
  if (partial.length > 1) {
    return { error: `${label} "${requestedName}" is ambiguous. Matches: ${partial.map((item) => item.name).join(", ")}.` };
  }
  return { error: `${label} not found: ${requestedName}` };
}
