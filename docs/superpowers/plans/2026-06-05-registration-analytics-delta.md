# Registration Analytics Delta Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the gaps between Murtaza's `/admin/registration` Registration Analytics page (commits `524b9de`…`be38bb8`) and the approved spec: department access, awaiting-utaro drill-down + per-hotel counts, guest-reported hosts view, CSV export, and the Local/Mehman drill fix.

**Architecture:** Surgical edits to the three existing files — no new pages, no new routes. The analytics API gains host fields + people-level counts; the detail API gains three segments (`open_to_utaro`, `host`, `local_mehman`); the page wires them up and adds CSV export to the existing DetailPanel.

**Tech Stack:** Same as the existing page — Next.js 16 client component, `x-admin-key` API auth, hand-rolled Tailwind bars.

**Spec:** `docs/superpowers/specs/2026-06-05-registration-stats-dashboard-design.md`
**Supersedes:** `docs/superpowers/plans/2026-06-05-registrations-page.md` (Murtaza's page shipped the bulk of it first — Task 5 marks it superseded)

**Spec decisions adopted from his implementation (do NOT churn these):**
- Age buckets <12 / 12–17 / 18–59 / 60+ replace the spec's 65+ senior cutoff (finer-grained, better for rahat planning)
- Drill-down side panel (DetailPanel) replaces the spec's expandable family table
- `pending` is the displayed status for `not_started`/`in_progress`/null

**Files touched:**
- Modify: `src/lib/admin/access.ts`
- Modify: `src/components/admin/AdminNav.tsx`
- Modify: `src/app/admin/registration/page.tsx`
- Modify: `src/app/api/admin/registration-analytics/route.ts`
- Modify: `src/app/api/admin/registration-analytics/detail/route.ts`

> Line numbers below are approximate (post-merge `d1362ff`) — anchor edits on the quoted code, not line numbers.

---

### Task 1: Department access

**Files:**
- Modify: `src/lib/admin/access.ts`
- Modify: `src/components/admin/AdminNav.tsx`
- Modify: `src/app/admin/registration/page.tsx`

- [ ] **Step 1: Add `canViewRegistrations` to `src/lib/admin/access.ts`**

Append after `canManageKnowledge` (end of file):

```ts
// Who may open the Registration Analytics page: admins/leadership, department PM/HOD, and IT.
export function canViewRegistrations(user: PortalUser | null | undefined) {
  return isAdminOrLeadership(user) || user?.is_manager === true || user?.is_it === true;
}
```

(Includes `is_it` so IT members who can see it today don't lose access.)

- [ ] **Step 2: Add a `registrations` access type to `AdminNav.tsx`**

In the access-comment block + `Access` type near the top:

```ts
// access controls who sees a link, matching each page's gate:
//  admin         = admin/leadership only
//  inbox         = admin/leadership or escalation support members
//  manage        = admin/leadership or department PM/HOD
//  mumineen      = admin/leadership or IT department members
//  registrations = admin/leadership, department PM/HOD, or IT
//  any           = any signed-in user
type Access = "admin" | "inbox" | "manage" | "mumineen" | "registrations" | "any";
```

In `canSee`, add before the final `manage` fallback line:

```ts
    if (itemAccess === "registrations") return access.isAdmin || access.isManager || access.isIt;
```

Change the nav entry (currently `AdminNav.tsx:39`):

```ts
      { href: "/admin/registration", label: "Registration Analytics", access: "registrations" },
```

- [ ] **Step 3: Swap the page gate in `src/app/admin/registration/page.tsx`**

Change the import:

```ts
import { canViewRegistrations } from "@/lib/admin/access";
```

and in the auth `useEffect` (~line 506):

```ts
    if (!canViewRegistrations(user)) { router.push("/admin/conversations"); return; }
```

(`canAccessMumineen` is no longer imported by this file.)

- [ ] **Step 4: Lint, commit**

Run: `npm run lint` — passes.

```bash
git add src/lib/admin/access.ts src/components/admin/AdminNav.tsx src/app/admin/registration/page.tsx
git commit -m "Registration: open analytics page to department PM/HODs"
```

---

### Task 2: Analytics API — host fields, people counts, per-hotel awaiting, hosts aggregation

**Files:**
- Modify: `src/app/api/admin/registration-analytics/route.ts`

- [ ] **Step 1: Select host fields**

Add to the `FamilyRow` type:

```ts
  utaro_host_name: string | null;
  utaro_host_its: string | null;
```

and extend the families select string to:

```ts
          "hof_its, registration_status, acc_type, hotel_name, open_to_utaro, transport_mode, submitted_at, utaro_host_name, utaro_host_its",
```

- [ ] **Step 2: People-per-family helper**

In the `── Accommodation ──` section, directly after the `registeredFams` declaration, insert:

```ts
  // People per family = attending members of that household (post global filters).
  const attendingByHof = new Map<string, number>();
  for (const m of attending) {
    attendingByHof.set(m.hof_its, (attendingByHof.get(m.hof_its) ?? 0) + 1);
  }
  const famPeople = (f: FamilyRow) => attendingByHof.get(f.hof_its) ?? 0;
```

and extend the existing counts below it:

```ts
  const hotelPeople = registeredFams.filter((f) => f.acc_type === "hotel").reduce((s, f) => s + famPeople(f), 0);
  const utaroPeople = registeredFams.filter((f) => f.acc_type === "utaro").reduce((s, f) => s + famPeople(f), 0);
  const openToUtaroPeople = registeredFams.filter((f) => f.open_to_utaro).reduce((s, f) => s + famPeople(f), 0);
```

- [ ] **Step 3: Enrich the per-hotel aggregation**

Replace the existing `hotelCounts` / `topHotels` block (keep `HOTEL_JUNK` as is) with:

```ts
  type HotelAgg = { name: string; count: number; people: number; awaiting: number; awaiting_people: number };
  const hotelCounts = new Map<string, HotelAgg>(); // keyed by lowercased name so case variants merge
  for (const f of registeredFams) {
    if (f.acc_type === "hotel" && f.hotel_name?.trim()) {
      const name = f.hotel_name.trim();
      if (HOTEL_JUNK.has(name.toLowerCase())) continue;
      const agg = hotelCounts.get(name.toLowerCase()) ?? { name, count: 0, people: 0, awaiting: 0, awaiting_people: 0 };
      agg.count += 1;
      agg.people += famPeople(f);
      if (f.open_to_utaro) {
        agg.awaiting += 1;
        agg.awaiting_people += famPeople(f);
      }
      hotelCounts.set(name.toLowerCase(), agg);
    }
  }
  const topHotels = Array.from(hotelCounts.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
```

- [ ] **Step 4: Hosts aggregation**

After the `topHotels` block, insert:

```ts
  // Hosts derived from guest-entered utaro fields: keyed by host ITS when present,
  // else normalized host name (free text — imperfect until the matching feature lands).
  type HostAgg = { key: string; label: string; families: number; people: number };
  const hostMap = new Map<string, HostAgg>();
  for (const f of registeredFams) {
    if (f.acc_type !== "utaro") continue;
    const its = f.utaro_host_its?.trim();
    const normName = (f.utaro_host_name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
    const key = its ? `its:${its}` : normName ? `name:${normName}` : null;
    if (!key) continue;
    const label = its ? `${f.utaro_host_name?.trim() || "Unknown host"} (ITS ${its})` : f.utaro_host_name!.trim();
    const agg = hostMap.get(key) ?? { key, label, families: 0, people: 0 };
    agg.families += 1;
    agg.people += famPeople(f);
    hostMap.set(key, agg);
  }
  const hosts = Array.from(hostMap.values()).sort(
    (a, b) => b.families - a.families || a.label.localeCompare(b.label),
  );
```

- [ ] **Step 5: Extend the response**

Replace the `accommodation:` object in the `NextResponse.json` payload with:

```ts
    accommodation: {
      hotel: hotelFams,
      hotel_people: hotelPeople,
      utaro: utaroFams,
      utaro_people: utaroPeople,
      open_to_utaro: openToUtaro,
      open_to_utaro_people: openToUtaroPeople,
      not_set: accNotSet,
      top_hotels: topHotels,
      hosts,
    },
```

- [ ] **Step 6: Lint, commit**

Run: `npm run lint` — passes. (Page type updates land in Task 4; the API response is additive so nothing breaks meanwhile.)

```bash
git add src/app/api/admin/registration-analytics/route.ts
git commit -m "Registration: analytics adds host fields, people counts, per-hotel awaiting-utaro"
```

---

### Task 3: Detail API — `open_to_utaro`, `host`, and `local_mehman` segments

**Files:**
- Modify: `src/app/api/admin/registration-analytics/detail/route.ts`

- [ ] **Step 1: Select host fields**

Add to the `FamilyDetail` type:

```ts
  utaro_host_name: string | null;
  utaro_host_its: string | null;
```

and extend `FAMILY_SELECT` to:

```ts
  const FAMILY_SELECT =
    "hof_its, registration_status, acc_type, hotel_name, open_to_utaro, transport_mode, transport_detail, submitted_at, utaro_host_name, utaro_host_its";
```

- [ ] **Step 2: Register the family segments**

```ts
  const isFamilySegment = ["hotel", "transport", "acc_type", "registration_status", "open_to_utaro", "host"].includes(segment);
```

- [ ] **Step 3: Add the segment filters**

In the family-segment `if/else` chain, after the `registration_status` branch, add:

```ts
    } else if (segment === "open_to_utaro") {
      // The awaiting-utaro matching pool: registered, hotel-booked, open to a host.
      // Optional value narrows to one hotel (per-hotel awaiting badge).
      fams = fams.filter(
        (f) =>
          (f.registration_status === "submitted" || f.registration_status === "confirmed") &&
          f.acc_type === "hotel" &&
          f.open_to_utaro &&
          (value === "" || f.hotel_name?.trim() === value),
      );
    } else if (segment === "host") {
      // value is the host key from the analytics response: "its:<its>" or "name:<normalized name>".
      fams = fams.filter((f) => {
        if (f.registration_status !== "submitted" && f.registration_status !== "confirmed") return false;
        if (f.acc_type !== "utaro") return false;
        const its = f.utaro_host_its?.trim();
        const normName = (f.utaro_host_name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
        const key = its ? `its:${its}` : normName ? `name:${normName}` : null;
        return key === value;
      });
    }
```

- [ ] **Step 4: Detail text for the new family segments**

In the family `rows = fams.map(...)` detail assignment chain, after the `registration_status` line, add:

```ts
      else if (segment === "open_to_utaro") detail = f.hotel_name?.trim() ?? "—";
      else if (segment === "host")
        detail = [f.utaro_host_name?.trim(), f.utaro_host_its?.trim() ? `ITS ${f.utaro_host_its.trim()}` : null]
          .filter(Boolean)
          .join(" · ");
```

- [ ] **Step 5: Add the `local_mehman` member segment**

In the member-segment `switch`, after the `attending` case, add:

```ts
      case "local_mehman":
        filtered = allMembers.filter((m) => !m.not_attending && m.local_mehman === value);
        break;
```

- [ ] **Step 6: Lint, commit**

Run: `npm run lint` — passes.

```bash
git add src/app/api/admin/registration-analytics/detail/route.ts
git commit -m "Registration: detail segments for awaiting-utaro pool, hosts, local/mehman"
```

---

### Task 4: Page — wire up awaiting utaro, hosts, people counts, drill fix, CSV export

**Files:**
- Modify: `src/app/admin/registration/page.tsx`

- [ ] **Step 1: Update the `Analytics` type**

Replace the `accommodation:` member of the `Analytics` type with:

```ts
  accommodation: {
    hotel: number;
    hotel_people: number;
    utaro: number;
    utaro_people: number;
    open_to_utaro: number;
    open_to_utaro_people: number;
    not_set: number;
    top_hotels: { name: string; count: number; people: number; awaiting: number; awaiting_people: number }[];
    hosts: { key: string; label: string; families: number; people: number }[];
  };
```

- [ ] **Step 2: Add `trailing` slot to `HBar`**

Extend `HBar`'s props with `trailing?: ReactNode` and render it after the count span:

```tsx
function HBar({
  label,
  value,
  total,
  color = "bg-blue-500",
  onClick,
  trailing,
}: {
  label: string;
  value: number;
  total: number;
  color?: string;
  onClick?: () => void;
  trailing?: ReactNode;
}) {
```

and in its JSX, directly after the existing `<span className="w-24 shrink-0 text-right text-sm">…</span>`:

```tsx
      {trailing}
```

- [ ] **Step 3: CSV export in `DetailPanel`**

Inside `DetailPanel`, after the `hasDetail`/`showGender`/`showAge` consts, add:

```tsx
  function exportCsv() {
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const header = ["Name", "ITS", "Gender", "Age", "Type", "Phone", "Email", req.detailLabel ?? "Details", "HOF ITS"];
    const lines = filtered.map((r) =>
      [r.name, r.its, r.gender, r.age, r.local_mehman, r.whatsapp, r.email, r.detail, r.hof_its].map(esc).join(","),
    );
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${req.label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
```

In the panel header, wrap the close button so an export button sits beside it — replace the existing close `<button …>` with:

```tsx
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={exportCsv}
              disabled={loading || filtered.length === 0}
              className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              Export CSV
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
```

(CSV exports the search-filtered rows currently shown — matches what the user sees.)

- [ ] **Step 4: Fix the Local/Mehman drill-downs**

Replace the two bars in the "Local vs Mehman" SectionCard (currently both `segment: "attending"`):

```tsx
                <HBar label="Mehman" value={summary.mehman} total={summary.total_mumineen} color="bg-indigo-500" onClick={() => drill({ segment: "local_mehman", value: "Mehman", label: "Mehman (attending)" })} />
                <HBar label="Local" value={summary.local} total={summary.total_mumineen} color="bg-teal-500" onClick={() => drill({ segment: "local_mehman", value: "Local", label: "Local (attending)" })} />
```

- [ ] **Step 5: Awaiting-utaro callout → drill-down + people counts on Hotel/Utaro bars**

In the Accommodation SectionCard, add `trailing` to the two top-level bars:

```tsx
                      <HBar label="Hotel" value={data.accommodation.hotel} total={total} color="bg-blue-500"
                        onClick={() => drill({ segment: "hotel", label: "All Hotel Families", detailLabel: "Hotel" })}
                        trailing={<span className="w-14 shrink-0 text-right text-xs text-gray-400">{data.accommodation.hotel_people} ppl</span>}
                      />
                      <HBar label="Utaro / Host" value={data.accommodation.utaro} total={total} color="bg-emerald-500"
                        onClick={() => drill({ segment: "acc_type", value: "utaro", label: "Utaro / Host Families", detailLabel: "Accommodation" })}
                        trailing={<span className="w-14 shrink-0 text-right text-xs text-gray-400">{data.accommodation.utaro_people} ppl</span>}
                      />
```

Replace the static `open_to_utaro` `<p>` callout with a drillable button:

```tsx
                      {data.accommodation.open_to_utaro > 0 && (
                        <button
                          type="button"
                          onClick={() => drill({ segment: "open_to_utaro", label: "Awaiting Utaro — hotel booked, open to a host", detailLabel: "Hotel" })}
                          className="mt-3 flex w-full items-center justify-between rounded-md bg-amber-50 px-3 py-2 text-left text-sm text-amber-800 hover:bg-amber-100 dark:bg-amber-950/30 dark:text-amber-300 dark:hover:bg-amber-950/50"
                        >
                          <span>
                            {data.accommodation.open_to_utaro}{" "}
                            {data.accommodation.open_to_utaro === 1 ? "family" : "families"} (
                            {data.accommodation.open_to_utaro_people} people) awaiting utaro
                          </span>
                          <span className="text-xs">View →</span>
                        </button>
                      )}
```

- [ ] **Step 6: Per-hotel rows — people count + awaiting badge**

Replace the `filteredHotels.map(...)` HBar with:

```tsx
                          {filteredHotels.map((h) => (
                            <HBar key={h.name} label={h.name} value={h.count} total={data.accommodation.hotel} color="bg-blue-400"
                              onClick={() => drill({ segment: "hotel", value: h.name, label: `${h.name} — families`, detailLabel: "Hotel" })}
                              trailing={
                                <span className="flex w-28 shrink-0 items-center justify-end gap-1">
                                  <span className="text-xs text-gray-400">{h.people} ppl</span>
                                  {h.awaiting > 0 && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        drill({ segment: "open_to_utaro", value: h.name, label: `${h.name} — awaiting utaro`, detailLabel: "Hotel" });
                                      }}
                                      className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 hover:bg-amber-200 dark:bg-amber-950/40 dark:text-amber-300"
                                      title={`${h.awaiting} families (${h.awaiting_people} people) at ${h.name} awaiting utaro`}
                                    >
                                      {h.awaiting} awaiting
                                    </button>
                                  )}
                                </span>
                              }
                            />
                          ))}
```

- [ ] **Step 7: Hosts list**

Still inside the Accommodation SectionCard, directly after the `filteredHotels` block's closing `)}`, add:

```tsx
                      {data.accommodation.hosts.length > 0 && (
                        <div className="mt-4">
                          <p className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">
                            Utaro hosts (guest-reported) — click to see who&apos;s staying with them
                          </p>
                          {data.accommodation.hosts.slice(0, 10).map((h) => (
                            <HBar key={h.key} label={h.label} value={h.families} total={data.accommodation.utaro} color="bg-emerald-400"
                              onClick={() => drill({ segment: "host", value: h.key, label: `${h.label} — guest families`, detailLabel: "Host" })}
                              trailing={<span className="w-14 shrink-0 text-right text-xs text-gray-400">{h.people} ppl</span>}
                            />
                          ))}
                          {data.accommodation.hosts.length > 10 && (
                            <p className="mt-1 text-xs text-gray-400">Showing top 10 of {data.accommodation.hosts.length} hosts.</p>
                          )}
                        </div>
                      )}
```

- [ ] **Step 8: Lint + build**

Run: `npm run lint` then `npm run build`
Expected: both pass.

- [ ] **Step 9: Manual verification**

`npm run dev`, sign in, open `/admin/registration`:
1. Awaiting-utaro button → panel lists hotel-booked open-to-utaro families with hotel name in Details; Export CSV downloads them.
2. A hotel's "N awaiting" badge → only that hotel's awaiting families (badge click doesn't also trigger the hotel drill).
3. Hosts list shows; clicking a host shows their guest families with host name · ITS in Details.
4. Hotel/Utaro bars and per-hotel rows show "ppl" counts; numbers are plausible vs family counts.
5. Local and Mehman bars now show only locals/mehman respectively.
6. Export CSV from a member-level panel (e.g. Wheelchair) — opens correctly in Excel, quoted fields intact.
7. Simulate an `is_manager` (non-IT, non-admin) user → nav shows Registration Analytics, page loads; plain committee user is redirected.

- [ ] **Step 10: Commit**

```bash
git add src/app/admin/registration/page.tsx
git commit -m "Registration: awaiting-utaro drill-down, hosts view, people counts, CSV export, local/mehman drill fix"
```

---

### Task 5: Mark the original plan superseded

**Files:**
- Modify: `docs/superpowers/plans/2026-06-05-registrations-page.md`

- [ ] **Step 1: Prepend a superseded banner**

Insert at the very top of the file (above the title):

```markdown
> **SUPERSEDED (2026-06-05).** Murtaza shipped `/admin/registration` (commits `524b9de`…`be38bb8`) covering ~80% of this plan before execution began. The remaining gaps are implemented by `2026-06-05-registration-analytics-delta.md`. Kept for reference only — do not execute.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/2026-06-05-registrations-page.md
git commit -m "Docs: mark original registrations-page plan superseded by analytics delta"
```

---

### Task 6: Final verification + push

- [ ] **Step 1: Full check**

Run: `npm run test && npm run lint && npm run build`
Expected: all pass (test suite is untouched by this work but must stay green).

- [ ] **Step 2: Push**

```bash
git push
```

---

## Spec coverage map (delta items only)

| Gap | Task |
|---|---|
| Dept PM/HOD access (`canViewRegistrations`, nav, page gate) | 1 |
| Awaiting-utaro pool drill-down | 2 (counts) + 3 (segment) + 4 (UI) |
| Per-hotel awaiting counts | 2 + 4 |
| Hosts view (guest-reported, ITS-keyed) | 2 + 3 + 4 |
| Per-hotel / acc-type people counts | 2 + 4 |
| CSV export of any drill-down | 4 |
| Local/Mehman drill mis-wire fix | 3 + 4 |
| Close out superseded plan | 5 |
