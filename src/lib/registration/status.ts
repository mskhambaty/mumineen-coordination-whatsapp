// Canonical registration-status buckets for the registration-analytics funnel and its
// drill-downs. `families.registration_status` is `text NOT NULL DEFAULT 'not_started'`; the
// live values are 'not_started' (pending submission), 'submitted'/'confirmed' (registered),
// and 'cancelled'. Both the overview counts and the detail drill-downs MUST classify status
// through these helpers so the funnel totals and the row lists they link to always agree.

// Registered = the family completed the form. 'confirmed' is treated as registered alongside
// 'submitted' since it's the recognized post-submission state elsewhere in the app.
export function isRegisteredStatus(status: string | null): boolean {
  return status === "submitted" || status === "confirmed";
}

// Pending submission = on the roster but not yet registered (and not cancelled). 'not_started'
// is the only value live data uses; 'pending' and null are tolerated as equivalents so the
// bucket is robust to legacy/edge rows.
export function isPendingStatus(status: string | null): boolean {
  return !status || status === "pending" || status === "not_started";
}

// Match a family's registration_status against a UI status filter or a funnel drill value
// ("submitted" | "pending" | "cancelled" | "confirmed").
export function matchesStatusFilter(status: string | null, filter: string): boolean {
  if (filter === "submitted") return isRegisteredStatus(status);
  if (filter === "pending") return isPendingStatus(status);
  return status === filter;
}
