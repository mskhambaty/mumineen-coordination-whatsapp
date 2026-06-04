// Shared input normalization for the registration write paths (public /api/register and the
// admin /api/admin/mumineen/update editor). Keeping these in one place avoids the two routes
// drifting on how a field is coerced or which enum values are allowed.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Sanitize a khidmat selection: keep valid UUIDs only, dedupe, cap at 3.
export const khidmatIds = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && UUID_RE.test(x)))].slice(0, 3) : [];

export const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
export const bool = (v: unknown) => v === true || v === "true";
export const num = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(str(v));
  return Number.isFinite(n) ? n : null;
};
export const ts = (v: unknown) => {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
export const oneOf = (v: unknown, allowed: readonly string[]) => {
  const s = str(v);
  return s && allowed.includes(s) ? s : null;
};

export const AIRPORTS = ["ORD", "MDW"] as const;
export const ACC_TYPES = ["hotel", "utaro"] as const;
export const TRANSPORT_MODES = ["rideshare", "rental", "commute_with_utaro", "other"] as const;
