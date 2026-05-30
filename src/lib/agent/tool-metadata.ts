const toolApiMap: Record<string, string> = {
  get_event_schedule: "Static response (schedule not yet published)",
  get_parking_info: "Static response (parking info not yet published)",
  get_directions: "Static response (directions not yet published)",
  get_faq_answer: "Static response (FAQ not yet published)",
  get_lost_found_info: "Static response (lost & found not yet published)",
  get_volunteer_assignment: "Static response (volunteer system not connected)",
  lookup_committee_contact: "Static response (directory not connected)",
  update_volunteer_status: "Static response (pending integration)",
  create_internal_note: "Static response (pending integration)",
  get_my_tasks: "GET /api/tasks or GET /api/tasks/kanban",
  get_task_detail: "GET /api/tasks/:id or GET /api/tasks (keyword search)",
  get_department_summary: "GET /api/departments/:id/summary",
  update_task_status: "PUT /api/tasks/:id",
  create_task: "POST /api/tasks",
  assign_task: "PUT /api/tasks/:id",
  get_top_blockers: "GET /api/tasks (filtered by blocked/overdue)",
  get_all_departments_summary: "GET /api/departments/summary/all",
  get_department_tasks: "GET /api/departments/:id/tasks",
  get_milestones: "GET /api/milestones",
  update_milestone: "PUT /api/milestones/:id",
};

export function getToolApiMapping(): Record<string, string> {
  return { ...toolApiMap };
}
