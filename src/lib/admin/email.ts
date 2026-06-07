// Email normalization + matching helpers shared by the auth routes.
//
// Stored emails are not guaranteed to be lowercased (some rows were created with
// mixed-case addresses), and PostgREST `.eq` is case-sensitive — so an exact
// match silently misses those users. We compare case-insensitively instead.

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// Build a PostgREST `ilike` pattern that matches the address *literally* and
// case-insensitively. `%`, `_`, and `\` are wildcards/escape chars in LIKE and
// must be escaped — `_` in particular is a valid email local-part character, so
// without escaping it would match any single character.
export function emailMatchPattern(email: string): string {
  return normalizeEmail(email).replace(/([\\%_])/g, "\\$1");
}
