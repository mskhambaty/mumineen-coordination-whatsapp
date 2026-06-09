// Canonical registration-status buckets for the registration-analytics funnel and its
// drill-downs. `families.registration_status` is `text NOT NULL DEFAULT 'not_started'` and the
// model is two-state: 'not_started' (pending submission) and 'submitted' (registered). Both the
// overview counts and the detail drill-downs MUST classify status through these helpers so the
// funnel totals and the row lists they link to always agree.

// Registered = the family completed the form.
export function isRegisteredStatus(status: string | null): boolean {
  return status === "submitted";
}

// Pending submission = on the roster but not yet registered.
export function isPendingStatus(status: string | null): boolean {
  return status === "not_started";
}

// Match a family's registration_status against a UI status filter or a funnel drill value
// ("submitted" | "pending").
export function matchesStatusFilter(status: string | null, filter: string): boolean {
  if (filter === "submitted") return isRegisteredStatus(status);
  if (filter === "pending") return isPendingStatus(status);
  return status === filter;
}
