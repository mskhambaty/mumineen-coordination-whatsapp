// Shared pure logic for the public relay-updates feed: category enum, input
// validation for the admin write routes, and serialization helpers.
// The category set and item shape are a CONTRACT with the static relay page
// (docs/relay-updates.md) — change them only together with that page.

export const RELAY_UPDATE_CATEGORIES = ["urgent", "schedule", "travel", "advisory"] as const;
export type RelayUpdateCategory = (typeof RELAY_UPDATE_CATEGORIES)[number];

export const MAX_TITLE_CHARS = 200;
export const MAX_BODY_CHARS = 1000;
export const MAX_LINK_CHARS = 500;
export const MAX_CTA_CHARS = 80;

export type RelayUpdateInput = {
  date: string; // yyyy-mm-dd
  title: string;
  body: string;
  category: RelayUpdateCategory;
  link: string | null;
  cta: string | null;
  published: boolean;
};

// `id` is always emitted (row UUID -> the card's data-id); link/cta only when set.
export type FeedItem = { id: string; date: string; title: string; body: string; category: string; link?: string; cta?: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type ValidationResult = { ok: true; value: RelayUpdateInput } | { ok: false; error: string };

export function validateRelayUpdateInput(raw: unknown): ValidationResult {
  const b = (raw ?? {}) as Record<string, unknown>;

  const date = typeof b.date === "string" ? b.date.trim() : "";
  if (!DATE_RE.test(date)) return { ok: false, error: "Date must be in yyyy-mm-dd format." };

  const title = typeof b.title === "string" ? b.title.trim() : "";
  if (!title) return { ok: false, error: "Title is required." };
  if (title.length > MAX_TITLE_CHARS) return { ok: false, error: `Title must be at most ${MAX_TITLE_CHARS} characters.` };

  const body = typeof b.body === "string" ? b.body.trim() : "";
  if (!body) return { ok: false, error: "Body is required." };
  if (body.length > MAX_BODY_CHARS) return { ok: false, error: `Body must be at most ${MAX_BODY_CHARS} characters.` };

  const category = typeof b.category === "string" ? b.category.trim().toLowerCase() : "";
  if (!(RELAY_UPDATE_CATEGORIES as readonly string[]).includes(category)) {
    return { ok: false, error: `Category must be one of: ${RELAY_UPDATE_CATEGORIES.join(", ")}.` };
  }

  // Optional CTA link: http(s) only (the page renders it as a real anchor).
  const link = typeof b.link === "string" && b.link.trim() ? b.link.trim() : null;
  if (link) {
    if (link.length > MAX_LINK_CHARS) return { ok: false, error: `Link must be at most ${MAX_LINK_CHARS} characters.` };
    if (!/^https?:\/\/\S+$/i.test(link)) return { ok: false, error: "Link must be an http(s) URL." };
  }

  const cta = typeof b.cta === "string" && b.cta.trim() ? b.cta.trim() : null;
  if (cta && !link) return { ok: false, error: "A CTA label requires a link." };
  if (cta && cta.length > MAX_CTA_CHARS) return { ok: false, error: `CTA label must be at most ${MAX_CTA_CHARS} characters.` };

  const published = b.published === undefined ? true : b.published === true || b.published === "true";

  return { ok: true, value: { date, title, body, category: category as RelayUpdateCategory, link, cta, published } };
}

// Row -> the exact item shape the static page consumes. `id` becomes the card's
// data-id; link/cta render a CTA anchor (new tab) and are omitted when unset.
export function toFeedItem(row: {
  id: string;
  date: string;
  title: string;
  body: string;
  category: string;
  link: string | null;
  cta: string | null;
}): FeedItem {
  const item: FeedItem = {
    id: row.id,
    date: String(row.date).slice(0, 10),
    title: row.title,
    body: row.body,
    category: row.category,
  };
  if (row.link) item.link = row.link;
  if (row.cta) item.cta = row.cta;
  return item;
}

function categoryLabel(category: string): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

// One embedding chunk per update, for site_content indexing.
export function buildUpdateChunks(rows: { date: string; title: string; body: string; category: string }[]): string[] {
  return rows.map((r) => `[${String(r.date).slice(0, 10)}] ${categoryLabel(r.category)} — ${r.title}: ${r.body}`);
}
