export const taskStatuses = ["open", "in_progress", "blocked", "complete"] as const;
export const taskPriorities = ["low", "medium", "high"] as const;
export const itemTypes = ["task", "issue"] as const;

export type TaskStatus = (typeof taskStatuses)[number];
export type TaskPriority = (typeof taskPriorities)[number];
export type ItemType = (typeof itemTypes)[number];

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && taskStatuses.includes(value as TaskStatus);
}

export function isTaskPriority(value: unknown): value is TaskPriority {
  return typeof value === "string" && taskPriorities.includes(value as TaskPriority);
}

export function parseTaskPriority(value: unknown): TaskPriority | null {
  if (value === "all" || value === null || value === undefined || value === "") {
    return null;
  }

  return isTaskPriority(value) ? value : "medium";
}

export function priorityWeight(priority: string | null | undefined): number {
  if (priority === "high") return 3;
  if (priority === "medium") return 2;
  if (priority === "low") return 1;
  return 0;
}
