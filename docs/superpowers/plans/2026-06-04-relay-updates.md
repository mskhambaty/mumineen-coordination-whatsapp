# Relay Updates Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the static relay page's "Latest updates" JSON feed from this app, with an admin-only portal page to author updates, and auto-index published updates into the agent's vector store.

**Architecture:** New `relay_updates` table (Supabase). A public CORS `GET /api/relay-updates` returns published rows in the static page's exact schema. Admin CRUD routes (`x-admin-key` + acting `user_id`, admin/leadership-only) back a new `/admin/relay-updates` portal page. Every successful write re-indexes all published updates into `site_content` under `updates://relay` via the existing `indexChunksForPage` helper.

**Tech Stack:** Next.js App Router route handlers, Supabase (service role), existing `src/lib/knowledge/index-content.ts` embedding helper, Tailwind admin page, vitest.

**Spec:** `docs/superpowers/specs/2026-06-04-relay-updates-design.md` · **Ticket:** #73

---

## File map

| Action | Path | Responsibility |
|---|---|---|
| Create | `supabase/migrations/20260604160000_relay_updates.sql` | `relay_updates` table |
| Create | `src/lib/relay-updates/shared.ts` | Category enum, input validation, feed serialization, chunk building (pure, testable) |
| Create | `src/lib/relay-updates/index-updates.ts` | Re-index published updates into `site_content` |
| Create | `src/app/api/relay-updates/route.ts` | Public feed GET + OPTIONS (CORS) |
| Create | `src/app/api/admin/relay-updates/route.ts` | Admin list (GET) + create (POST) |
| Create | `src/app/api/admin/relay-updates/[id]/route.ts` | Admin edit/publish-toggle (PUT) |
| Create | `src/app/admin/relay-updates/page.tsx` | Portal page: table + create/edit modal |
| Modify | `src/components/admin/AdminNav.tsx` | Nav link in External group (`access: "admin"`) |
| Create | `src/lib/__tests__/relay-updates.test.ts` | Validation + serializer + chunk tests |
| Create | `docs/relay-updates.md` | Feature doc (incl. static-page endpoint-change instructions) |
| Modify | `docs/openapi.yaml`, `docs/database.md`, `docs/index.md` | Contract + schema + doc map |

---

### Task 1: Database migration

**Files:**
- Create: `supabase/migrations/20260604160000_relay_updates.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- Public "Latest updates" feed for the static relay-center page (see docs/relay-updates.md).
-- Authored by admin/leadership in the portal; served as JSON by GET /api/relay-updates.

create table if not exists public.relay_updates (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  title text not null,
  body text not null,
  category text not null check (category in ('urgent','schedule','travel','advisory')),
  link text,
  cta text,
  published boolean not null default true,
  created_by uuid references public.whatsapp_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists relay_updates_published_date_idx on public.relay_updates (published, date desc);

alter table public.relay_updates enable row level security;

comment on table public.relay_updates is 'Updates shown on the public relay-center page (and indexed for the WhatsApp agent).';
```

- [ ] **Step 2: Apply the migration to the live project**

This must be applied with the **matching ledger version** so repo and remote history stay aligned (no repeat of issue #57). Two options:

- Preferred (main session has Supabase MCP): call `mcp__supabase__apply_migration` with `name: "relay_updates"` and the SQL above, then verify with `mcp__supabase__list_migrations` that the new version exists, and **rename the repo file** to match the ledger version Supabase assigned (e.g. `2026MMDDHHMMSS_relay_updates.sql`).
- If executing as a subagent without MCP access: leave the file as-is and report back — the main session applies it at review time.

Expected: `relay_updates` exists in the live DB; `select count(*) from relay_updates` returns 0.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/*relay_updates.sql
git commit -m "Relay updates: relay_updates table migration (#73)"
```

---

### Task 2: Shared lib — validation, serialization, chunks (TDD)

**Files:**
- Create: `src/lib/relay-updates/shared.ts`
- Test: `src/lib/__tests__/relay-updates.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, expect, it } from "vitest";

import {
  RELAY_UPDATE_CATEGORIES,
  buildUpdateChunks,
  toFeedItem,
  validateRelayUpdateInput,
} from "@/lib/relay-updates/shared";

const valid = {
  date: "2026-06-10",
  title: "Shuttle schedule posted",
  body: "Shuttles run every 30 minutes from both hotels.",
  category: "travel",
};

describe("validateRelayUpdateInput", () => {
  it("accepts a valid input and defaults published to true, link/cta to null", () => {
    const r = validateRelayUpdateInput(valid);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual({ ...valid, link: null, cta: null, published: true });
    }
  });

  it("accepts an http(s) link with a cta label", () => {
    const r = validateRelayUpdateInput({ ...valid, link: "https://www.chicagorelaycenter.com/parking", cta: "View your zone" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.link).toBe("https://www.chicagorelaycenter.com/parking");
      expect(r.value.cta).toBe("View your zone");
    }
  });

  it("rejects a non-http link and a cta without a link", () => {
    expect(validateRelayUpdateInput({ ...valid, link: "javascript:alert(1)" }).ok).toBe(false);
    expect(validateRelayUpdateInput({ ...valid, cta: "View" }).ok).toBe(false);
  });

  it("accepts an explicit published=false", () => {
    const r = validateRelayUpdateInput({ ...valid, published: false });
    expect(r.ok && r.value.published).toBe(false);
  });

  it("rejects an unknown category", () => {
    const r = validateRelayUpdateInput({ ...valid, category: "general" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/category/i);
  });

  it("rejects a malformed date", () => {
    const r = validateRelayUpdateInput({ ...valid, date: "06/10/2026" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/date/i);
  });

  it("rejects a missing title and an overlong title", () => {
    expect(validateRelayUpdateInput({ ...valid, title: "  " }).ok).toBe(false);
    expect(validateRelayUpdateInput({ ...valid, title: "x".repeat(201) }).ok).toBe(false);
  });

  it("rejects a missing body and an overlong body", () => {
    expect(validateRelayUpdateInput({ ...valid, body: "" }).ok).toBe(false);
    expect(validateRelayUpdateInput({ ...valid, body: "x".repeat(1001) }).ok).toBe(false);
  });

  it("exposes exactly the four categories", () => {
    expect([...RELAY_UPDATE_CATEGORIES]).toEqual(["urgent", "schedule", "travel", "advisory"]);
  });
});

describe("toFeedItem", () => {
  it("maps a row to the static page schema with id, omitting unset link/cta", () => {
    expect(
      toFeedItem({ id: "u-1", date: "2026-06-10", title: "T", body: "B", category: "urgent", link: null, cta: null }),
    ).toEqual({ id: "u-1", date: "2026-06-10", title: "T", body: "B", category: "urgent" });
  });

  it("includes link and cta when set", () => {
    expect(
      toFeedItem({ id: "u-2", date: "2026-06-10", title: "T", body: "B", category: "travel", link: "https://x.test/p", cta: "Go" }),
    ).toEqual({ id: "u-2", date: "2026-06-10", title: "T", body: "B", category: "travel", link: "https://x.test/p", cta: "Go" });
  });

  it("trims a timestamp-style date to yyyy-mm-dd", () => {
    expect(toFeedItem({ id: "u-3", date: "2026-06-10T00:00:00", title: "T", body: "B", category: "urgent", link: null, cta: null }).date).toBe(
      "2026-06-10",
    );
  });
});

describe("leadership gate shapes", () => {
  // The route gate (requireLeadership) defers to isAdminOrLeadership; pin the shapes it must accept/reject.
  it("accepts admin and leadership, rejects everyone else", async () => {
    const { isAdminOrLeadership } = await import("@/lib/admin/access");
    expect(isAdminOrLeadership({ role: "admin" })).toBe(true);
    expect(isAdminOrLeadership({ global_role: "leadership_admin" })).toBe(true);
    expect(isAdminOrLeadership({ role: "committee", global_role: "pm" })).toBe(false);
    expect(isAdminOrLeadership(null)).toBe(false);
  });
});

describe("buildUpdateChunks", () => {
  it("renders one chunk per update with date, category label, title, and body", () => {
    const chunks = buildUpdateChunks([
      { date: "2026-06-10", title: "T1", body: "B1", category: "travel" },
      { date: "2026-06-09", title: "T2", body: "B2", category: "urgent" },
    ]);
    expect(chunks).toEqual([
      "[2026-06-10] Travel — T1: B1",
      "[2026-06-09] Urgent — T2: B2",
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/relay-updates.test.ts`
Expected: FAIL — cannot resolve `@/lib/relay-updates/shared`.

- [ ] **Step 3: Write the implementation**

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/relay-updates.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/relay-updates/shared.ts src/lib/__tests__/relay-updates.test.ts
git commit -m "Relay updates: shared validation + serialization lib with tests (#73)"
```

---

### Task 3: Vector-store indexer

**Files:**
- Create: `src/lib/relay-updates/index-updates.ts`

- [ ] **Step 1: Write the indexer**

Mirrors `indexFaqBucket` (`src/lib/knowledge/index-content.ts`): delete-then-insert all chunks for one `page_url`.

```typescript
import { indexChunksForPage } from "@/lib/knowledge/index-content";
import { getSupabaseAdmin } from "@/lib/supabase/server";

import { buildUpdateChunks } from "./shared";

export const RELAY_UPDATES_PAGE_URL = "updates://relay";

// Re-embed ALL published updates into site_content (replacing previous chunks) so the
// agent's get_site_content_faq answers from the same news the public page shows.
// Unpublished updates simply drop out on the next call. Deliberately EXCLUDES link/cta:
// the agent may only share the asharamubaraka.net URL (see run-agent.ts), so update links
// must not enter its retrieval context.
export async function reindexRelayUpdates(): Promise<number> {
  const { data, error } = await getSupabaseAdmin()
    .from("relay_updates")
    .select("date, title, body, category")
    .eq("published", true)
    .order("date", { ascending: false });
  if (error) throw new Error(`relay_updates read failed: ${error.message}`);

  return indexChunksForPage(RELAY_UPDATES_PAGE_URL, "Relay Center Updates", buildUpdateChunks(data ?? []));
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep relay-updates || echo OK`
Expected: `OK` (no type errors in the new files).

- [ ] **Step 3: Commit**

```bash
git add src/lib/relay-updates/index-updates.ts
git commit -m "Relay updates: site_content indexer for published updates (#73)"
```

---

### Task 4: Public feed endpoint

**Files:**
- Create: `src/app/api/relay-updates/route.ts`

- [ ] **Step 1: Write the route**

```typescript
import { NextResponse } from "next/server";

import { toFeedItem } from "@/lib/relay-updates/shared";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

// The static relay page (asharamubaraka.net) fetches this cross-origin, so CORS must be open.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

// GET /api/relay-updates — public JSON feed for the static page's "Latest updates" section.
// Returns ONLY published rows, newest first, in the page's exact schema. ~1 min CDN cache.
export async function GET() {
  const { data, error } = await getSupabaseAdmin()
    .from("relay_updates")
    .select("id, date, title, body, category, link, cta")
    .eq("published", true)
    .order("date", { ascending: false });

  if (error) {
    // The page falls back to its baked-in updates on any non-OK response.
    return NextResponse.json({ error: error.message }, { status: 500, headers: CORS_HEADERS });
  }

  return NextResponse.json((data ?? []).map(toFeedItem), {
    headers: {
      ...CORS_HEADERS,
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
    },
  });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
```

- [ ] **Step 2: Smoke-test locally**

Run: `npm run dev` (background), then:
`curl -s -i http://localhost:3000/api/relay-updates | head -20`
Expected: `200`, `access-control-allow-origin: *`, body `[]` (empty table). Stop the dev server.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/relay-updates/route.ts
git commit -m "Relay updates: public CORS feed endpoint (#73)"
```

---

### Task 5: Admin API routes

**Files:**
- Create: `src/lib/relay-updates/auth.ts`
- Create: `src/app/api/admin/relay-updates/route.ts`
- Create: `src/app/api/admin/relay-updates/[id]/route.ts`

- [ ] **Step 1: Write the shared leadership gate**

Next.js route files may only export route handlers/config, so the shared gate lives in a lib module. `isAdminOrLeadership` (from `src/lib/admin/access.ts`) works on any `{role, global_role}` object.

`src/lib/relay-updates/auth.ts`:

```typescript
import { NextResponse } from "next/server";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { getSupabaseAdmin } from "@/lib/supabase/server";

// Resolve the acting portal user (body user_id) and require admin/leadership.
// Returns an error response to send, or null when allowed.
export async function requireLeadership(userId: string): Promise<NextResponse | null> {
  if (!userId) {
    return NextResponse.json({ error: "Missing user id" }, { status: 400 });
  }
  const { data: user } = await getSupabaseAdmin()
    .from("whatsapp_users")
    .select("id, role, global_role")
    .eq("id", userId)
    .maybeSingle();
  if (!user || !isAdminOrLeadership(user)) {
    return NextResponse.json({ error: "Only admins or leadership can manage relay updates." }, { status: 403 });
  }
  return null;
}
```

- [ ] **Step 2: Write the list + create route**

House conventions: `requireAdminKey` gate; acting user's `id` in the body. Indexing failures are logged, never fail the write.

```typescript
import { NextRequest, NextResponse } from "next/server";

import { requireAdminKey } from "@/lib/api/auth";
import { requireLeadership } from "@/lib/relay-updates/auth";
import { reindexRelayUpdates } from "@/lib/relay-updates/index-updates";
import { validateRelayUpdateInput } from "@/lib/relay-updates/shared";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
// Embedding the re-index can take a moment.
export const maxDuration = 60;

async function reindexBestEffort() {
  try {
    await reindexRelayUpdates();
  } catch (err) {
    console.error("relay updates re-index failed:", err);
  }
}

// GET: all updates (incl. unpublished) for the portal table, newest first.
export async function GET(req: NextRequest) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data, error } = await getSupabaseAdmin()
    .from("relay_updates")
    .select("id, date, title, body, category, link, cta, published, created_at, updated_at, creator:whatsapp_users!relay_updates_created_by_fkey(display_name)")
    .order("date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ updates: data ?? [] });
}

// POST: create an update. Body: { user_id, date, title, body, category, published? }
export async function POST(req: NextRequest) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const denied = await requireLeadership(typeof body.user_id === "string" ? body.user_id : "");
  if (denied) return denied;

  const result = validateRelayUpdateInput(body);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const { data, error } = await getSupabaseAdmin()
    .from("relay_updates")
    .insert({ ...result.value, created_by: body.user_id as string })
    .select("id")
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await reindexBestEffort();
  return NextResponse.json({ ok: true, id: data?.id });
}
```

- [ ] **Step 3: Write the edit route**

```typescript
import { NextRequest, NextResponse } from "next/server";

import { requireAdminKey } from "@/lib/api/auth";
import { requireLeadership } from "@/lib/relay-updates/auth";
import { reindexRelayUpdates } from "@/lib/relay-updates/index-updates";
import { validateRelayUpdateInput } from "@/lib/relay-updates/shared";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

// PUT: full-field edit (incl. publish toggle). Body: { user_id, date, title, body, category, published }
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const denied = await requireLeadership(typeof body.user_id === "string" ? body.user_id : "");
  if (denied) return denied;

  const result = validateRelayUpdateInput(body);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const { data, error } = await getSupabaseAdmin()
    .from("relay_updates")
    .update({ ...result.value, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Update not found." }, { status: 404 });
  }

  try {
    await reindexRelayUpdates();
  } catch (err) {
    console.error("relay updates re-index failed:", err);
  }
  return NextResponse.json({ ok: true, id: data.id });
}
```

Note: `params` is a Promise in this Next.js version — match the pattern used by existing `[id]` routes (check `src/app/api/tasks/[id]/route.ts` and copy its exact `params` signature if it differs).

- [ ] **Step 4: Lint + typecheck**

Run: `npm run lint && npx tsc --noEmit 2>&1 | grep relay || echo OK`
Expected: lint passes; `OK`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/relay-updates/auth.ts src/app/api/admin/relay-updates/
git commit -m "Relay updates: admin list/create/edit routes (#73)"
```

---

### Task 6: Admin portal page + nav link

**Files:**
- Create: `src/app/admin/relay-updates/page.tsx`
- Modify: `src/components/admin/AdminNav.tsx` (External group, after the Mumineen link, line ~38)

- [ ] **Step 1: Add the nav link**

In `dropdownGroups`, External group links array, add:

```typescript
      { href: "/admin/relay-updates", label: "Relay Updates", access: "admin" },
```

- [ ] **Step 2: Write the page**

Follows the house client-page pattern (`NEXT_PUBLIC_ADMIN_KEY`, `localStorage admin_user`, redirect non-admins, Tailwind + dark-mode classes):

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { RELAY_UPDATE_CATEGORIES } from "@/lib/relay-updates/shared";

type Update = {
  id: string;
  date: string;
  title: string;
  body: string;
  category: string;
  link: string | null;
  cta: string | null;
  published: boolean;
  created_at: string;
  updated_at: string;
  creator: { display_name: string | null } | null;
};

type Draft = { id?: string; date: string; title: string; body: string; category: string; link: string; cta: string; published: boolean };

const CATEGORY_BADGE: Record<string, string> = {
  urgent: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  schedule: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  travel: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  advisory: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300",
};

function emptyDraft(): Draft {
  return { date: new Date().toISOString().slice(0, 10), title: "", body: "", category: "advisory", link: "", cta: "", published: true };
}

export default function RelayUpdatesPage() {
  const router = useRouter();
  const adminKey = process.env.NEXT_PUBLIC_ADMIN_KEY ?? "";
  const [userId, setUserId] = useState("");
  const [updates, setUpdates] = useState<Update[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/relay-updates", { headers: { "x-admin-key": adminKey } });
    const data = await res.json().catch(() => ({}));
    if (res.ok) setUpdates(data.updates ?? []);
    else setError(data.error ?? "Failed to load updates");
    setLoading(false);
  }, [adminKey]);

  useEffect(() => {
    // Page gate: admin/leadership only (mirrors the API rule).
    try {
      const user = JSON.parse(localStorage.getItem("admin_user") ?? "null");
      if (!user || !isAdminOrLeadership(user)) {
        router.push("/admin");
        return;
      }
      setUserId(user.id ?? "");
    } catch {
      router.push("/admin/login");
      return;
    }
    void load();
  }, [router, load]);

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    const isEdit = Boolean(draft.id);
    const res = await fetch(isEdit ? `/api/admin/relay-updates/${draft.id}` : "/api/admin/relay-updates", {
      method: isEdit ? "PUT" : "POST",
      headers: { "Content-Type": "application/json", "x-admin-key": adminKey },
      body: JSON.stringify({ ...draft, user_id: userId }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setError(data.error ?? "Save failed");
      return;
    }
    setDraft(null);
    void load();
  }

  async function togglePublished(u: Update) {
    setError(null);
    const res = await fetch(`/api/admin/relay-updates/${u.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-admin-key": adminKey },
      body: JSON.stringify({ ...u, published: !u.published, user_id: userId }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Update failed");
      return;
    }
    void load();
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold dark:text-gray-100">Relay Updates</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Posted to the public relay-center page&apos;s “Latest updates” section and indexed for the WhatsApp agent.
          </p>
        </div>
        <button
          onClick={() => setDraft(emptyDraft())}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          New Update
        </button>
      </div>

      {error && <div className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">{error}</div>}

      {loading ? (
        <p className="text-gray-500 dark:text-gray-400">Loading…</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border dark:border-gray-700">
          <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                {["Date", "Title", "Category", "Status", "By", "Actions"].map((h) => (
                  <th key={h} className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-300">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white dark:divide-gray-800 dark:bg-gray-900">
              {updates.map((u) => (
                <tr key={u.id}>
                  <td className="whitespace-nowrap px-4 py-3 dark:text-gray-200">{u.date}</td>
                  <td className="px-4 py-3 dark:text-gray-200">
                    <div className="font-medium">{u.title}</div>
                    <div className="mt-0.5 line-clamp-2 text-xs text-gray-500 dark:text-gray-400">{u.body}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${CATEGORY_BADGE[u.category] ?? ""}`}>
                      {u.category}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${u.published ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300" : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"}`}>
                      {u.published ? "Published" : "Unpublished"}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-500 dark:text-gray-400">{u.creator?.display_name ?? "—"}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <button onClick={() => setDraft({ id: u.id, date: u.date, title: u.title, body: u.body, category: u.category, link: u.link ?? "", cta: u.cta ?? "", published: u.published })} className="text-blue-600 hover:underline dark:text-blue-400">Edit</button>
                    <button onClick={() => togglePublished(u)} className="ml-3 text-gray-600 hover:underline dark:text-gray-300">
                      {u.published ? "Unpublish" : "Publish"}
                    </button>
                  </td>
                </tr>
              ))}
              {updates.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">No updates yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {draft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl dark:bg-gray-900">
            <h2 className="text-lg font-semibold dark:text-gray-100">{draft.id ? "Edit Update" : "New Update"}</h2>
            <div className="mt-4 space-y-4">
              <div className="flex gap-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Date
                  <input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} className="mt-1 block rounded-md border px-3 py-2 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100" />
                </label>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Category
                  <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} className="mt-1 block rounded-md border px-3 py-2 capitalize dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100">
                    {RELAY_UPDATE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
              </div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Title
                <input value={draft.title} maxLength={200} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className="mt-1 block w-full rounded-md border px-3 py-2 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100" />
              </label>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Body
                <textarea value={draft.body} maxLength={1000} rows={4} onChange={(e) => setDraft({ ...draft, body: e.target.value })} className="mt-1 block w-full rounded-md border px-3 py-2 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100" />
              </label>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Link (optional — card shows a CTA button to this URL)
                <input type="url" value={draft.link} maxLength={500} placeholder="https://…" onChange={(e) => setDraft({ ...draft, link: e.target.value })} className="mt-1 block w-full rounded-md border px-3 py-2 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100" />
              </label>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                CTA label (optional — requires a link; page default otherwise)
                <input value={draft.cta} maxLength={80} placeholder="View your zone" disabled={!draft.link.trim()} onChange={(e) => setDraft({ ...draft, cta: e.target.value })} className="mt-1 block w-full rounded-md border px-3 py-2 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100" />
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input type="checkbox" checked={draft.published} onChange={(e) => setDraft({ ...draft, published: e.target.checked })} />
                Published
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button onClick={() => setDraft(null)} className="rounded-md border px-4 py-2 text-sm dark:border-gray-700 dark:text-gray-300">Cancel</button>
              <button onClick={save} disabled={saving || !draft.title.trim() || !draft.body.trim()} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Manual smoke-test**

Run `npm run dev`, sign in to `/admin`, open **External → Relay Updates**: create an update, edit it, unpublish it. Then `curl -s http://localhost:3000/api/relay-updates` — published items appear, unpublished don't. Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/relay-updates/page.tsx src/components/admin/AdminNav.tsx
git commit -m "Relay updates: admin portal page + nav link (#73)"
```

---

### Task 7: Documentation

**Files:**
- Create: `docs/relay-updates.md`
- Modify: `docs/openapi.yaml` (add the three paths), `docs/database.md` (table section), `docs/index.md` (doc-map row + key-file line)

- [ ] **Step 1: Write `docs/relay-updates.md`**

```markdown
# Relay Updates Feed

## Overview

The public Chicago Relay Center page (static HTML on asharamubaraka.net) loads its
**Latest updates** section from a JSON feed. This app serves that feed and provides the
portal UI to author updates.

## Feed Contract (shared with the static page)

`GET /api/relay-updates` — public, CORS `Access-Control-Allow-Origin: *`,
`Cache-Control: public, s-maxage=60, stale-while-revalidate=300`.

Returns published updates, newest first:

```json
[{
  "id": "4b6c…-uuid",
  "date": "2026-06-10",
  "title": "…",
  "body": "…",
  "category": "travel",
  "link": "https://www.chicagorelaycenter.com/parking",
  "cta": "View your zone"
}]
```

`category` ∈ `urgent | schedule | travel | advisory` (lowercase). `id` (row UUID) becomes
the card's `data-id`; optional `link`/`cta` render a CTA anchor (new tab, `rel="noopener"`)
and are omitted when unset. The page HTML-escapes fields client-side and falls back to
baked-in updates if the fetch fails.

**Static-page configuration (manual, outside this repo):** set the page's
`UPDATES_ENDPOINT` constant to `https://<this-app-domain>/api/relay-updates` and make sure
its category tabs match the four categories above.

## Authoring

- Portal page: **External → Relay Updates** (`/admin/relay-updates`) — table + create/edit
  modal with publish toggle. Admin/leadership only.
- Lifecycle: create + edit + unpublish (no hard delete).
- API: `GET/POST /api/admin/relay-updates`, `PUT /api/admin/relay-updates/[id]`
  (admin key + acting `user_id`; server checks admin/leadership).

## Agent Indexing

Every successful write re-indexes all published updates into `site_content` under
`page_url = 'updates://relay'` (one chunk per update), so `get_site_content_faq` answers
from the same news. Indexing failures are logged and never fail the write.
Source: `src/lib/relay-updates/index-updates.ts`.

## Data

Table `relay_updates` — see [database.md](./database.md). Validation caps: title ≤ 200
chars, body ≤ 1000 chars, date `yyyy-mm-dd`.
```

- [ ] **Step 2: Add the table to `docs/database.md`** (after the `app_settings`-adjacent sections, keeping alphabetical-ish flow)

```markdown
### `relay_updates`

Updates shown on the public relay-center page (and indexed for the WhatsApp agent). See [relay-updates.md](./relay-updates.md).

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `date` | date | Display date on the page |
| `title` | text | ≤ 200 chars (API-validated) |
| `body` | text | ≤ 1000 chars (API-validated) |
| `category` | text | `urgent` \| `schedule` \| `travel` \| `advisory` |
| `link` | text | Optional CTA URL (http/https, ≤ 500 chars; nullable) |
| `cta` | text | Optional CTA label (≤ 80 chars; requires `link`; nullable) |
| `published` | boolean | Default `true`; unpublished rows are excluded from the feed and the vector index |
| `created_by` | uuid | FK → `whatsapp_users.id` (nullable on delete) |
| `created_at` / `updated_at` | timestamptz | `updated_at` app-managed |

Index: `(published, date desc)`.
```

- [ ] **Step 3: Add the routes to `docs/openapi.yaml`**

Follow the file's existing style (check how `/api/admin/escalation-support` is documented and mirror it) for:
- `GET /api/relay-updates` (public; 200 array of feed items)
- `GET /api/admin/relay-updates`, `POST /api/admin/relay-updates` (x-admin-key)
- `PUT /api/admin/relay-updates/{id}` (x-admin-key)

- [ ] **Step 4: Add to `docs/index.md`**

Doc-map row: `| [relay-updates.md](./relay-updates.md) | Public relay-page updates feed: endpoint, authoring UI, agent indexing |`
Key-file line: `src/app/api/relay-updates/route.ts       — Public relay updates JSON feed`

- [ ] **Step 5: Commit**

```bash
git add docs/relay-updates.md docs/openapi.yaml docs/database.md docs/index.md
git commit -m "Relay updates: feature + API + schema docs (#73)"
```

---

### Task 8: Final verification

- [ ] **Step 1: Run the full gate**

```bash
npm run lint && npm run test && npm run build
```
Expected: all pass.

- [ ] **Step 2: Push and update ticket #73**

```bash
git push origin main
gh issue comment 73 --repo mskhambaty/mumineen-coordination-whatsapp --body "Implemented: feed endpoint, admin UI, indexing, docs (commits on main). Remaining: external page changes — repoint UPDATES_ENDPOINT and update category tabs."
```

Leave #73 **open** until the static page's endpoint/tab changes are deployed by its host and the feed is verified live end-to-end.
