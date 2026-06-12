# Webinars

Public-facing page at **`/webinars`** that shows recorded Ashara Mubaraka webinars
(YouTube videos) to registered mumineen.

## Access

- **Gate:** non-admin visitors must enter a valid ITS number, verified against the
  active roster via `POST /api/webinars/verify-its`. On success the page stores a
  `webinars_verified` flag in `sessionStorage` and greets the member by first name.
  The endpoint returns only the first name — no other PII.
- **Admins/leadership** (resolved from the portal session) skip the gate and get the
  **Add webinar** and **Manage** controls.

## Layout

The page is a **responsive video card grid** (3 columns on desktop, 2 on tablet,
1 on mobile), ordered by `seq` ascending:

- Each card shows the YouTube thumbnail (`hqdefault.jpg`, cropped to 16:9), a red
  play badge, the title, and a 2-line-clamped description. If the thumbnail fails to
  load, the card falls back to a play-icon placeholder.
- Tapping a card opens a **modal player** (autoplaying YouTube embed) over the grid,
  with the title/description in a footer. Closing (✕ button, backdrop click, or Esc)
  returns to the grid. When a video finishes, the modal stays open — there is no
  auto-advance.

## Admin

- **Add webinar:** title + YouTube URL (validated to contain a detectable video ID)
  + optional description → `POST /api/webinars`.
- **Manage:** a toggle panel listing every webinar with a **Remove** action
  (`DELETE /api/webinars/:id`, soft-deactivates via `active = false`).

## API

| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| `/api/webinars` | GET | public | List active webinars (`seq` ascending) |
| `/api/webinars` | POST | admin/leadership | Create a webinar |
| `/api/webinars/:id` | DELETE | admin/leadership | Deactivate a webinar |
| `/api/webinars/verify-its` | POST | public | Verify an ITS number, return first name |

## Key files

```
src/app/webinars/page.tsx              — ITS gate, card grid, modal player, admin controls
src/lib/webinars/youtube.ts            — extractYouTubeId / thumbnail / embed URL helpers (unit-tested)
src/app/api/webinars/route.ts          — GET (public) + POST (admin)
src/app/api/webinars/[id]/route.ts     — DELETE (admin)
src/app/api/webinars/verify-its/route.ts — ITS verification (public)
supabase/migrations/20260607230000_create_webinars_table.sql — webinars table + RLS
```

The old per-webinar route `src/app/webinars/[seq]/page.tsx` now redirects to the
unified `/webinars` grid.
