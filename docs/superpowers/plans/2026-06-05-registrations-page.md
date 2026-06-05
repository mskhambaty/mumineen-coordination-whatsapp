# Registrations Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only `/admin/registrations` page where department PMs/HODs browse registered families (expandable to members), with stat cards on top that filter the table, plus CSV export.

**Architecture:** One API route returns raw family + member rows (service-role Supabase, paged). All aggregation, filtering, and CSV generation live in a pure lib module (`src/lib/registrations/aggregate.ts`, vitest-tested). The page is a single client component following the existing admin-page pattern (localStorage auth gate, `x-admin-key` fetches, hand-rolled Tailwind stat cards/bars — no chart library).

**Tech Stack:** Next.js 16 app router, React 19 client component, Supabase JS (service role via `getSupabaseAdmin`), Tailwind 4, vitest.

**Spec:** `docs/superpowers/specs/2026-06-05-registration-stats-dashboard-design.md`

**Conventions (from this repo — follow them):**
- Admin API routes authorize with `requireAdminKey(req)` (header `x-admin-key` checked against `ADMIN_API_KEY`). Role gating happens client-side on the page via `localStorage.admin_user` + a predicate in `src/lib/admin/access.ts`. The spec's `canViewRegistrations` gate is the client-side page gate (same as every other admin page).
- API responses return snake_case DB rows (see `src/app/api/admin/mumineen/search/route.ts`). The spec sketched camelCase; use snake_case to match the codebase — the lib module derives `hofName`/`size` by joining.
- Commits go directly to `main`. Commit messages look like `Registrations: <what>`.
- `registration_status` values are `not_started | in_progress | submitted | confirmed | cancelled` (cancel flow sets `cancelled`, see `src/app/api/admin/mumineen/registration/route.ts`).
- `local_mehman` is exactly `"Local"` or `"Mehman"` (see `src/app/api/admin/mumineen/route.ts:21-22`).
- `is_adult` is a generated column (`age >= 18`) and is **null when age is null**.

---

### Task 1: Access predicate + nav link

**Files:**
- Modify: `src/lib/admin/access.ts`
- Modify: `src/components/admin/AdminNav.tsx:38`

- [ ] **Step 1: Add `canViewRegistrations` to `src/lib/admin/access.ts`**

Append after `canManageKnowledge` (end of file):

```ts
// Who may open the Registrations page: admins/leadership plus department PM/HOD.
export function canViewRegistrations(user: PortalUser | null | undefined) {
  return isAdminOrLeadership(user) || user?.is_manager === true;
}
```

(Deliberately its own named function rather than reusing `canManageKnowledge` — same predicate today, but the intent differs and they may diverge.)

- [ ] **Step 2: Add the nav link**

In `src/components/admin/AdminNav.tsx`, in the `External` group's `links` array, insert directly after the `/admin/mumineen` line:

```ts
      { href: "/admin/registrations", label: "Registrations", access: "manage" },
```

The existing `"manage"` access type already renders for admin/leadership + `is_manager` — no other nav changes needed.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: passes (no new warnings in the two touched files).

- [ ] **Step 4: Commit**

```bash
git add src/lib/admin/access.ts src/components/admin/AdminNav.tsx
git commit -m "Registrations: access predicate + nav link"
```

---

### Task 2: Aggregation lib (pure, TDD)

**Files:**
- Create: `src/lib/registrations/aggregate.ts`
- Test: `src/lib/__tests__/registrations.test.ts`

This module owns every type and every piece of logic the page needs: join families↔members, classify members, match filters, compute stats, search, CSV.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/registrations.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  Family,
  FamilyRow,
  MemberRow,
  computeStats,
  familiesToCsv,
  familyMatches,
  hostKey,
  isRegistered,
  joinFamilies,
  memberMatches,
  membersToCsv,
  searchMatches,
} from "@/lib/registrations/aggregate";

const fam = (over: Partial<FamilyRow> = {}): FamilyRow => ({
  id: "f1",
  hof_its: "10000001",
  registration_status: "submitted",
  acc_type: null,
  hotel_name: null,
  open_to_utaro: false,
  utaro_host_name: null,
  utaro_host_its: null,
  transport_mode: null,
  transport_detail: null,
  ...over,
});

const mem = (over: Partial<MemberRow> = {}): MemberRow => ({
  its: "20000001",
  family_id: "f1",
  hof_its: "10000001",
  is_head: false,
  full_name: "Test Mumin",
  gender: "M",
  age: 30,
  is_adult: true,
  local_mehman: "Mehman",
  rahat_seating: false,
  wheelchair: false,
  special_needs: null,
  ...over,
});

describe("joinFamilies", () => {
  it("groups members under their family with hofName from the head and size", () => {
    const families = joinFamilies(
      [fam()],
      [
        mem({ its: "1", is_head: true, full_name: "Head Bhai" }),
        mem({ its: "2", full_name: "Kid", age: 5, is_adult: false }),
        mem({ its: "3", family_id: "other" }),
      ],
    );
    expect(families).toHaveLength(1);
    expect(families[0].members.map((m) => m.its)).toEqual(["1", "2"]);
    expect(families[0].hofName).toBe("Head Bhai");
    expect(families[0].size).toBe(2);
  });

  it("falls back to the first member's name when no head row exists", () => {
    const families = joinFamilies([fam()], [mem({ full_name: "Only Member" })]);
    expect(families[0].hofName).toBe("Only Member");
  });
});

describe("memberMatches", () => {
  it("classifies age buckets with 65 as the senior boundary", () => {
    expect(memberMatches(mem({ age: 64 }), "senior")).toBe(false);
    expect(memberMatches(mem({ age: 64 }), "adult")).toBe(true);
    expect(memberMatches(mem({ age: 65 }), "senior")).toBe(true);
    expect(memberMatches(mem({ age: 65 }), "adult")).toBe(false);
    expect(memberMatches(mem({ age: 10, is_adult: false }), "kid")).toBe(true);
    expect(memberMatches(mem({ age: null, is_adult: null }), "kid")).toBe(false);
    expect(memberMatches(mem({ age: null, is_adult: null }), "senior")).toBe(false);
  });

  it("matches local/mehman by exact roster value", () => {
    expect(memberMatches(mem({ local_mehman: "Local" }), "local")).toBe(true);
    expect(memberMatches(mem({ local_mehman: "Local" }), "mehman")).toBe(false);
    expect(memberMatches(mem({ local_mehman: "Mehman" }), "mehman")).toBe(true);
    expect(memberMatches(mem({ local_mehman: null }), "mehman")).toBe(false);
  });

  it("treats whitespace-only special_needs as empty", () => {
    expect(memberMatches(mem({ special_needs: "  " }), "special")).toBe(false);
    expect(memberMatches(mem({ special_needs: "allergy" }), "special")).toBe(true);
  });
});

describe("hostKey", () => {
  it("prefers host ITS, falls back to normalized host name, null for non-utaro", () => {
    expect(hostKey(fam({ acc_type: "utaro", utaro_host_its: " 30000001 ", utaro_host_name: "X" }))).toBe("its:30000001");
    expect(hostKey(fam({ acc_type: "utaro", utaro_host_name: "  Shk  Yusuf " }))).toBe("name:shk yusuf");
    expect(hostKey(fam({ acc_type: "hotel", hotel_name: "Marriott" }))).toBeNull();
  });
});

describe("familyMatches", () => {
  const join = (f: FamilyRow, ms: MemberRow[]): Family => joinFamilies([f], ms)[0];

  it("awaiting_utaro requires registered + hotel + open_to_utaro", () => {
    const filter = { kind: "awaiting_utaro", label: "Awaiting utaro" } as const;
    expect(familyMatches(join(fam({ acc_type: "hotel", open_to_utaro: true }), [mem()]), filter)).toBe(true);
    expect(familyMatches(join(fam({ acc_type: "hotel", open_to_utaro: false }), [mem()]), filter)).toBe(false);
    expect(familyMatches(join(fam({ acc_type: "hotel", open_to_utaro: true, registration_status: "in_progress" }), [mem()]), filter)).toBe(false);
  });

  it("hotel_awaiting narrows awaiting to one hotel (normalized name)", () => {
    const f = join(fam({ acc_type: "hotel", hotel_name: " Marriott  Downtown ", open_to_utaro: true }), [mem()]);
    expect(familyMatches(f, { kind: "hotel_awaiting", value: "marriott downtown", label: "" })).toBe(true);
    expect(familyMatches(f, { kind: "hotel_awaiting", value: "hilton", label: "" })).toBe(false);
  });

  it("status filter matches its bucket regardless of registered population", () => {
    const f = join(fam({ registration_status: "not_started" }), [mem()]);
    expect(familyMatches(f, { kind: "status", value: "not_started", label: "" })).toBe(true);
    expect(familyMatches(f, { kind: "acc", value: "hotel", label: "" })).toBe(false);
  });

  it("member filter matches families containing >=1 matching member", () => {
    const f = join(fam(), [mem({ wheelchair: true }), mem({ its: "x" })]);
    expect(familyMatches(f, { kind: "member", value: "wheelchair", label: "" })).toBe(true);
    expect(familyMatches(f, { kind: "member", value: "rahat", label: "" })).toBe(false);
  });

  it("transport 'none' matches registered families without a mode", () => {
    expect(familyMatches(join(fam({ transport_mode: null }), [mem()]), { kind: "transport", value: "none", label: "" })).toBe(true);
    expect(familyMatches(join(fam({ transport_mode: "rental" }), [mem()]), { kind: "transport", value: "rental", label: "" })).toBe(true);
  });
});

describe("computeStats", () => {
  const families = joinFamilies(
    [
      fam({ id: "f1", hof_its: "1", acc_type: "hotel", hotel_name: "Marriott", open_to_utaro: true, transport_mode: "rental" }),
      fam({ id: "f2", hof_its: "2", acc_type: "hotel", hotel_name: " marriott ", open_to_utaro: false, transport_mode: "rideshare" }),
      fam({ id: "f3", hof_its: "3", acc_type: "utaro", utaro_host_its: "999", utaro_host_name: "Yusuf bhai", transport_mode: "commute_with_utaro" }),
      fam({ id: "f4", hof_its: "4", acc_type: "utaro", utaro_host_its: " 999", utaro_host_name: "Shk Yusuf", registration_status: "confirmed" }),
      fam({ id: "f5", hof_its: "5", registration_status: "not_started" }),
      fam({ id: "f6", hof_its: "6", registration_status: "cancelled" }),
    ],
    [
      mem({ its: "a", family_id: "f1", age: 70 }),
      mem({ its: "b", family_id: "f1", gender: "F", age: 10, is_adult: false, wheelchair: true }),
      mem({ its: "c", family_id: "f2", local_mehman: "Local", rahat_seating: true }),
      mem({ its: "d", family_id: "f3", special_needs: "diabetic" }),
      mem({ its: "e", family_id: "f4" }),
      mem({ its: "f", family_id: "f5" }),
    ],
  );
  const stats = computeStats(families);

  it("funnel counts every family by status", () => {
    expect(stats.funnel).toEqual([
      { status: "not_started", families: 1 },
      { status: "in_progress", families: 0 },
      { status: "submitted", families: 3 },
      { status: "confirmed", families: 1 },
      { status: "cancelled", families: 1 },
    ]);
  });

  it("counts registered families/people only (submitted + confirmed)", () => {
    expect(stats.registeredFamilies).toBe(4);
    expect(stats.registeredPeople).toBe(5);
    expect(stats.demo).toEqual({
      local: 1, mehman: 4, male: 4, female: 1,
      kids: 1, adults: 3, seniors: 1,
      rahat: 1, wheelchair: 1, special: 1,
    });
  });

  it("aggregates hotels by normalized name with awaiting counts", () => {
    expect(stats.acc).toEqual({
      hotelFamilies: 2, hotelPeople: 3,
      utaroFamilies: 2, utaroPeople: 2,
      awaitingFamilies: 1, awaitingPeople: 2,
    });
    expect(stats.hotels).toEqual([
      { key: "marriott", label: "Marriott", families: 2, people: 3, awaitingFamilies: 1, awaitingPeople: 2 },
    ]);
  });

  it("groups hosts by ITS even when guest-entered names differ", () => {
    expect(stats.hosts).toEqual([
      { key: "its:999", label: "Yusuf bhai (ITS 999)", families: 2, people: 2 },
    ]);
  });

  it("buckets transport including 'none' for registered families without a mode", () => {
    expect(stats.transport).toEqual([
      { mode: "rideshare", families: 1, people: 1 },
      { mode: "rental", families: 1, people: 2 },
      { mode: "commute_with_utaro", families: 1, people: 1 },
      { mode: "other", families: 0, people: 0 },
      { mode: "none", families: 1, people: 1 },
    ]);
  });
});

describe("search + csv", () => {
  const families = joinFamilies(
    [fam({ hotel_name: 'Say "Hi", Hotel', acc_type: "hotel" })],
    [mem({ its: "1", is_head: true, full_name: "Head Bhai" }), mem({ its: "2", full_name: "Zahra Ben" })],
  );

  it("searchMatches hits HOF ITS, HOF name, and member name/ITS", () => {
    expect(searchMatches(families[0], "head")).toBe(true);
    expect(searchMatches(families[0], "zahra")).toBe(true);
    expect(searchMatches(families[0], "10000001")).toBe(true);
    expect(searchMatches(families[0], "nope")).toBe(false);
  });

  it("familiesToCsv escapes quotes/commas and has one line per family", () => {
    const csv = familiesToCsv(families);
    const lines = csv.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("HOF ITS");
    expect(lines[1]).toContain('"Say ""Hi"", Hotel"');
  });

  it("membersToCsv has one line per member with family context", () => {
    const csv = membersToCsv(families[0].members.map((m) => ({ member: m, family: families[0] })));
    expect(csv.split("\n")).toHaveLength(3);
    expect(csv).toContain("Zahra Ben");
    expect(csv).toContain("Head Bhai");
  });

  it("isRegistered is true only for submitted/confirmed", () => {
    expect(isRegistered(families[0])).toBe(true);
    expect(isRegistered(joinFamilies([fam({ registration_status: "cancelled" })], [])[0])).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/registrations.test.ts`
Expected: FAIL — cannot resolve `@/lib/registrations/aggregate`.

- [ ] **Step 3: Implement the module**

Create `src/lib/registrations/aggregate.ts`:

```ts
// Pure aggregation/filtering logic for the admin Registrations page.
// Raw rows come from /api/admin/registrations; everything derived happens here.

export type RegistrationStatus = "not_started" | "in_progress" | "submitted" | "confirmed" | "cancelled";
export type TransportMode = "rideshare" | "rental" | "commute_with_utaro" | "other";
export type TransportBucket = TransportMode | "none";

export type FamilyRow = {
  id: string;
  hof_its: string;
  registration_status: RegistrationStatus;
  acc_type: "hotel" | "utaro" | null;
  hotel_name: string | null;
  open_to_utaro: boolean;
  utaro_host_name: string | null;
  utaro_host_its: string | null;
  transport_mode: TransportMode | null;
  transport_detail: string | null;
};

export type MemberRow = {
  its: string;
  family_id: string | null;
  hof_its: string;
  is_head: boolean;
  full_name: string | null;
  gender: "M" | "F" | null;
  age: number | null;
  is_adult: boolean | null; // generated (age >= 18); null when age is null
  local_mehman: string | null; // "Local" | "Mehman" from the roster import
  rahat_seating: boolean;
  wheelchair: boolean;
  special_needs: string | null;
};

export type Family = FamilyRow & {
  members: MemberRow[];
  hofName: string | null;
  size: number;
};

export const SENIOR_AGE = 65;

export type MemberFlag =
  | "male" | "female"
  | "kid" | "adult" | "senior"
  | "local" | "mehman"
  | "rahat" | "wheelchair" | "special";

export type Filter =
  | { kind: "status"; value: RegistrationStatus; label: string }
  | { kind: "acc"; value: "hotel" | "utaro"; label: string }
  | { kind: "awaiting_utaro"; label: string }
  | { kind: "hotel"; value: string; label: string }
  | { kind: "hotel_awaiting"; value: string; label: string }
  | { kind: "host"; value: string; label: string }
  | { kind: "transport"; value: TransportBucket; label: string }
  | { kind: "member"; value: MemberFlag; label: string };

export const FUNNEL_ORDER: RegistrationStatus[] = ["not_started", "in_progress", "submitted", "confirmed", "cancelled"];

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

export function joinFamilies(families: FamilyRow[], members: MemberRow[]): Family[] {
  const byFamily = new Map<string, MemberRow[]>();
  for (const m of members) {
    if (!m.family_id) continue;
    const list = byFamily.get(m.family_id);
    if (list) list.push(m);
    else byFamily.set(m.family_id, [m]);
  }
  return families.map((f) => {
    const mems = byFamily.get(f.id) ?? [];
    const head = mems.find((m) => m.is_head) ?? mems[0];
    return { ...f, members: mems, hofName: head?.full_name ?? null, size: mems.length };
  });
}

// Spec population rule: section stats and the default table cover submitted + confirmed only.
export const isRegistered = (f: FamilyRow) =>
  f.registration_status === "submitted" || f.registration_status === "confirmed";

export function memberMatches(m: MemberRow, flag: MemberFlag): boolean {
  switch (flag) {
    case "male": return m.gender === "M";
    case "female": return m.gender === "F";
    case "kid": return m.is_adult === false;
    case "adult": return m.is_adult === true && (m.age ?? 0) < SENIOR_AGE;
    case "senior": return m.age !== null && m.age >= SENIOR_AGE;
    case "local": return m.local_mehman === "Local";
    case "mehman": return m.local_mehman === "Mehman";
    case "rahat": return m.rahat_seating;
    case "wheelchair": return m.wheelchair;
    case "special": return Boolean(m.special_needs && m.special_needs.trim());
  }
}

export const hotelKey = (name: string | null) => norm(name);

// Hosts are derived from guest-entered fields: key by host ITS when present,
// else by normalized host name (free text, so imperfect until the matching feature lands).
export function hostKey(f: FamilyRow): string | null {
  if (f.acc_type !== "utaro") return null;
  const its = f.utaro_host_its?.trim();
  if (its) return `its:${its}`;
  const name = norm(f.utaro_host_name);
  return name ? `name:${name}` : null;
}

export function familyMatches(f: Family, filter: Filter): boolean {
  switch (filter.kind) {
    case "status": return f.registration_status === filter.value;
    case "acc": return isRegistered(f) && f.acc_type === filter.value;
    case "awaiting_utaro": return isRegistered(f) && f.acc_type === "hotel" && f.open_to_utaro;
    case "hotel": return isRegistered(f) && f.acc_type === "hotel" && hotelKey(f.hotel_name) === filter.value;
    case "hotel_awaiting":
      return isRegistered(f) && f.acc_type === "hotel" && f.open_to_utaro && hotelKey(f.hotel_name) === filter.value;
    case "host": return isRegistered(f) && hostKey(f) === filter.value;
    case "transport":
      return isRegistered(f) && (filter.value === "none" ? f.transport_mode === null : f.transport_mode === filter.value);
    case "member": return isRegistered(f) && f.members.some((m) => memberMatches(m, filter.value));
  }
}

// Stable identity for toggling the active filter on/off.
export const filterKey = (f: Filter) => ("value" in f ? `${f.kind}:${f.value}` : f.kind);

export function searchMatches(f: Family, q: string): boolean {
  if (f.hof_its.toLowerCase().includes(q)) return true;
  if ((f.hofName ?? "").toLowerCase().includes(q)) return true;
  return f.members.some((m) => m.its.toLowerCase().includes(q) || (m.full_name ?? "").toLowerCase().includes(q));
}

export type HotelStat = { key: string; label: string; families: number; people: number; awaitingFamilies: number; awaitingPeople: number };
export type HostStat = { key: string; label: string; families: number; people: number };

export type Stats = {
  funnel: Array<{ status: RegistrationStatus; families: number }>;
  registeredFamilies: number;
  registeredPeople: number;
  demo: {
    local: number; mehman: number; male: number; female: number;
    kids: number; adults: number; seniors: number;
    rahat: number; wheelchair: number; special: number;
  };
  acc: {
    hotelFamilies: number; hotelPeople: number;
    utaroFamilies: number; utaroPeople: number;
    awaitingFamilies: number; awaitingPeople: number;
  };
  hotels: HotelStat[];
  hosts: HostStat[];
  transport: Array<{ mode: TransportBucket; families: number; people: number }>;
};

export function computeStats(families: Family[]): Stats {
  const funnelCounts = new Map<RegistrationStatus, number>(FUNNEL_ORDER.map((s) => [s, 0]));
  for (const f of families) funnelCounts.set(f.registration_status, (funnelCounts.get(f.registration_status) ?? 0) + 1);

  const registered = families.filter(isRegistered);
  const demo = { local: 0, mehman: 0, male: 0, female: 0, kids: 0, adults: 0, seniors: 0, rahat: 0, wheelchair: 0, special: 0 };
  const demoFlags: Array<[keyof typeof demo, MemberFlag]> = [
    ["local", "local"], ["mehman", "mehman"], ["male", "male"], ["female", "female"],
    ["kids", "kid"], ["adults", "adult"], ["seniors", "senior"],
    ["rahat", "rahat"], ["wheelchair", "wheelchair"], ["special", "special"],
  ];

  const acc = { hotelFamilies: 0, hotelPeople: 0, utaroFamilies: 0, utaroPeople: 0, awaitingFamilies: 0, awaitingPeople: 0 };
  const hotels = new Map<string, HotelStat>();
  const hosts = new Map<string, HostStat>();
  const transportBuckets: TransportBucket[] = ["rideshare", "rental", "commute_with_utaro", "other", "none"];
  const transport = new Map<TransportBucket, { families: number; people: number }>(
    transportBuckets.map((m) => [m, { families: 0, people: 0 }]),
  );

  let registeredPeople = 0;
  for (const f of registered) {
    registeredPeople += f.size;
    for (const m of f.members) {
      for (const [key, flag] of demoFlags) {
        if (memberMatches(m, flag)) demo[key] += 1;
      }
    }

    if (f.acc_type === "hotel") {
      acc.hotelFamilies += 1;
      acc.hotelPeople += f.size;
      if (f.open_to_utaro) {
        acc.awaitingFamilies += 1;
        acc.awaitingPeople += f.size;
      }
      const key = hotelKey(f.hotel_name);
      const existing = hotels.get(key) ?? {
        key,
        label: f.hotel_name?.trim() || "(No hotel name)",
        families: 0, people: 0, awaitingFamilies: 0, awaitingPeople: 0,
      };
      existing.families += 1;
      existing.people += f.size;
      if (f.open_to_utaro) {
        existing.awaitingFamilies += 1;
        existing.awaitingPeople += f.size;
      }
      hotels.set(key, existing);
    } else if (f.acc_type === "utaro") {
      acc.utaroFamilies += 1;
      acc.utaroPeople += f.size;
      const key = hostKey(f);
      if (key) {
        const label = key.startsWith("its:")
          ? `${f.utaro_host_name?.trim() || "Unknown host"} (ITS ${key.slice(4)})`
          : f.utaro_host_name?.trim() || "Unknown host";
        const existing = hosts.get(key) ?? { key, label, families: 0, people: 0 };
        existing.families += 1;
        existing.people += f.size;
        hosts.set(key, existing);
      }
    }

    const bucket: TransportBucket = f.transport_mode ?? "none";
    const t = transport.get(bucket)!;
    t.families += 1;
    t.people += f.size;
  }

  return {
    funnel: FUNNEL_ORDER.map((status) => ({ status, families: funnelCounts.get(status) ?? 0 })),
    registeredFamilies: registered.length,
    registeredPeople,
    demo,
    acc,
    hotels: [...hotels.values()].sort((a, b) => b.families - a.families || a.label.localeCompare(b.label)),
    hosts: [...hosts.values()].sort((a, b) => b.families - a.families || a.label.localeCompare(b.label)),
    transport: transportBuckets.map((mode) => ({ mode, ...transport.get(mode)! })),
  };
}

export function csvEscape(value: string | number | boolean | null | undefined): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function familiesToCsv(rows: Family[]): string {
  const header = [
    "HOF ITS", "HOF Name", "Status", "People", "Accommodation", "Hotel",
    "Open To Utaro", "Host Name", "Host ITS", "Transport Mode", "Transport Detail",
  ];
  const lines = rows.map((f) =>
    [
      f.hof_its, f.hofName, f.registration_status, f.size, f.acc_type, f.hotel_name,
      f.acc_type === "hotel" ? f.open_to_utaro : "", f.utaro_host_name, f.utaro_host_its,
      f.transport_mode, f.transport_detail,
    ].map(csvEscape).join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

export function membersToCsv(rows: Array<{ member: MemberRow; family: Family }>): string {
  const header = [
    "ITS", "Name", "Age", "Gender", "Local/Mehman", "Rahat Seating", "Wheelchair",
    "Special Needs", "HOF ITS", "HOF Name",
  ];
  const lines = rows.map(({ member: m, family: f }) =>
    [m.its, m.full_name, m.age, m.gender, m.local_mehman, m.rahat_seating, m.wheelchair, m.special_needs, f.hof_its, f.hofName]
      .map(csvEscape).join(","),
  );
  return [header.join(","), ...lines].join("\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/registrations.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Run the full suite to confirm nothing else broke**

Run: `npm run test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/registrations/aggregate.ts src/lib/__tests__/registrations.test.ts
git commit -m "Registrations: pure aggregation/filter/CSV lib with tests"
```

---

### Task 3: API route

**Files:**
- Create: `src/app/api/admin/registrations/route.ts`

Returns ALL active families and attending members in one response. Supabase caps selects at 1000 rows, so page with `.range()` until a short page comes back.

- [ ] **Step 1: Create the route**

Create `src/app/api/admin/registrations/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";

import { requireAdminKey } from "@/lib/api/auth";
import type { FamilyRow, MemberRow } from "@/lib/registrations/aggregate";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

const PAGE_SIZE = 1000;

type Page<T> = { data: T[] | null; error: { message: string } | null };

// Supabase caps selects at 1000 rows; pull every page so counts are never silently truncated.
async function fetchAll<T>(fetchPage: (from: number, to: number) => PromiseLike<Page<T>>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

// GET /api/admin/registrations — raw family + attending-member rows for the Registrations page.
// All aggregation happens client-side (see src/lib/registrations/aggregate.ts).
export async function GET(req: NextRequest) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const supabase = getSupabaseAdmin();
  try {
    const families = await fetchAll<FamilyRow>((from, to) =>
      supabase
        .from("families")
        .select(
          "id, hof_its, registration_status, acc_type, hotel_name, open_to_utaro, " +
            "utaro_host_name, utaro_host_its, transport_mode, transport_detail",
        )
        .eq("roster_active", true)
        .order("hof_its")
        .range(from, to),
    );
    const members = await fetchAll<MemberRow>((from, to) =>
      supabase
        .from("mumineen")
        .select(
          "its, family_id, hof_its, is_head, full_name, gender, age, is_adult, " +
            "local_mehman, rahat_seating, wheelchair, special_needs",
        )
        .eq("roster_active", true)
        .eq("not_attending", false)
        .order("its")
        .range(from, to),
    );
    return NextResponse.json({ families, members });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to load registrations" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: passes.

- [ ] **Step 3: Manual smoke test against the dev server**

Run: `npm run dev` (background), then in PowerShell (reads the key from `.env.local`):

```powershell
$key = (Get-Content .env.local | Select-String '^ADMIN_API_KEY=').ToString().Split('=',2)[1]
(Invoke-RestMethod -Uri "http://localhost:3000/api/admin/registrations" -Headers @{ "x-admin-key" = $key }).families.Count
```

Expected: a family count > 0 (matches the families count visible on `/admin/mumineen`). Also confirm a 401:

```powershell
try { Invoke-RestMethod -Uri "http://localhost:3000/api/admin/registrations" } catch { $_.Exception.Response.StatusCode.value__ }
```

Expected: `401`. Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/admin/registrations/route.ts
git commit -m "Registrations: paged admin API returning family + member rows"
```

---

### Task 4: The page

**Files:**
- Create: `src/app/admin/registrations/page.tsx`

Single client component, same skeleton as other admin pages: localStorage auth gate → fetch with `x-admin-key` → render. Stat panels on top (every stat toggles a filter), registrations table below. Member-level filters force-expand rows to the matching members. Table display caps at 400 rows (with a visible note); CSV always exports the full filtered set.

- [ ] **Step 1: Create the page**

Create `src/app/admin/registrations/page.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { canViewRegistrations } from "@/lib/admin/access";
import {
  Family,
  FamilyRow,
  Filter,
  MemberFlag,
  MemberRow,
  RegistrationStatus,
  TransportBucket,
  computeStats,
  familiesToCsv,
  familyMatches,
  filterKey,
  isRegistered,
  joinFamilies,
  memberMatches,
  membersToCsv,
  searchMatches,
} from "@/lib/registrations/aggregate";

const MAX_TABLE_ROWS = 400;

const STATUS_LABELS: Record<RegistrationStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  submitted: "Submitted",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
};

const STATUS_BADGE: Record<RegistrationStatus, string> = {
  not_started: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  in_progress: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  submitted: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  confirmed: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  cancelled: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

const STATUS_BAR_COLOR: Record<RegistrationStatus, string> = {
  not_started: "bg-gray-400",
  in_progress: "bg-amber-500",
  submitted: "bg-blue-500",
  confirmed: "bg-green-500",
  cancelled: "bg-red-400",
};

const TRANSPORT_LABELS: Record<TransportBucket, string> = {
  rideshare: "Rideshare (Uber/Lyft)",
  rental: "Rental car",
  commute_with_utaro: "Commute with host",
  other: "Other",
  none: "Not specified",
};

export default function RegistrationsPage() {
  const router = useRouter();
  const adminKey = process.env.NEXT_PUBLIC_ADMIN_KEY ?? "";

  const [rows, setRows] = useState<{ families: FamilyRow[]; members: MemberRow[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter | null>(null);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    const token = localStorage.getItem("admin_token");
    if (!token) {
      router.push("/admin/login");
      return;
    }
    const raw = localStorage.getItem("admin_user");
    const user = raw
      ? (JSON.parse(raw) as { role?: string; global_role?: string; is_manager?: boolean })
      : null;
    if (!canViewRegistrations(user)) {
      router.push("/admin/conversations");
      return;
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/registrations", { headers: { "x-admin-key": adminKey } });
      const body = (await res.json()) as { families?: FamilyRow[]; members?: MemberRow[]; error?: string };
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
      setRows({ families: body.families ?? [], members: body.members ?? [] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load registrations");
    } finally {
      setLoading(false);
    }
  }

  const families = useMemo(() => (rows ? joinFamilies(rows.families, rows.members) : []), [rows]);
  const stats = useMemo(() => computeStats(families), [families]);

  const visible = useMemo(() => {
    const base = families.filter((f) => (filter ? familyMatches(f, filter) : isRegistered(f)));
    const q = search.trim().toLowerCase();
    return q ? base.filter((f) => searchMatches(f, q)) : base;
  }, [families, filter, search]);

  // Member-level filters force rows open to just the matching members.
  const memberFlag: MemberFlag | null = filter?.kind === "member" ? filter.value : null;

  function toggleFilter(next: Filter) {
    setFilter((cur) => (cur && filterKey(cur) === filterKey(next) ? null : next));
    setExpanded(new Set());
  }

  function toggleExpanded(id: string) {
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function membersFor(f: Family): MemberRow[] {
    return memberFlag ? f.members.filter((m) => memberMatches(m, memberFlag)) : f.members;
  }

  function downloadCsv() {
    const csv = memberFlag
      ? membersToCsv(visible.flatMap((f) => membersFor(f).map((member) => ({ member, family: f }))))
      : familiesToCsv(visible);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filter ? `registrations-${filterKey(filter).replace(/[^a-z0-9_-]+/gi, "-")}.csv` : "registrations.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const isActive = (f: Filter) => Boolean(filter && filterKey(filter) === filterKey(f));

  const demoItems: Array<{ flag: MemberFlag; label: string; value: number }> = [
    { flag: "local", label: "Local", value: stats.demo.local },
    { flag: "mehman", label: "Mehman", value: stats.demo.mehman },
    { flag: "male", label: "Men", value: stats.demo.male },
    { flag: "female", label: "Women", value: stats.demo.female },
    { flag: "kid", label: "Kids (<18)", value: stats.demo.kids },
    { flag: "adult", label: "Adults (18–64)", value: stats.demo.adults },
    { flag: "senior", label: "Seniors (65+)", value: stats.demo.seniors },
    { flag: "rahat", label: "Rahat seating", value: stats.demo.rahat },
    { flag: "wheelchair", label: "Wheelchair", value: stats.demo.wheelchair },
    { flag: "special", label: "Special needs", value: stats.demo.special },
  ];

  if (loading) {
    return <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 text-gray-500 dark:text-gray-400">Loading registrations…</main>;
  }

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold dark:text-gray-100">Registrations</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Click any stat to filter the table below. Stats cover submitted + confirmed registrations.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          Refresh
        </button>
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </div>
      ) : null}

      {/* ---- Overview & Demographics (Mawaid / Flow) ---- */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Registration funnel (all families)">
          <div className="space-y-3">
            {stats.funnel.map((row) => (
              <ClickableBar
                key={row.status}
                label={STATUS_LABELS[row.status]}
                value={row.families}
                max={Math.max(1, ...stats.funnel.map((r) => r.families))}
                color={STATUS_BAR_COLOR[row.status]}
                active={isActive({ kind: "status", value: row.status, label: "" })}
                onClick={() => toggleFilter({ kind: "status", value: row.status, label: STATUS_LABELS[row.status] })}
              />
            ))}
          </div>
        </Panel>
        <Panel title="Registered demographics (people)">
          <div className="mb-3 grid grid-cols-2 gap-3">
            <ReadonlyMetric label="Registered families" value={stats.registeredFamilies} />
            <ReadonlyMetric label="Registered people" value={stats.registeredPeople} />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {demoItems.map((item) => (
              <StatButton
                key={item.flag}
                label={item.label}
                value={item.value}
                active={isActive({ kind: "member", value: item.flag, label: "" })}
                onClick={() => toggleFilter({ kind: "member", value: item.flag, label: item.label })}
              />
            ))}
          </div>
        </Panel>
      </div>

      {/* ---- Accommodation ---- */}
      <Panel title="Accommodation">
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatButton
            label="Hotel"
            value={stats.acc.hotelFamilies}
            sub={`${stats.acc.hotelPeople} people`}
            active={isActive({ kind: "acc", value: "hotel", label: "" })}
            onClick={() => toggleFilter({ kind: "acc", value: "hotel", label: "Hotel" })}
          />
          <StatButton
            label="Utaro (host family)"
            value={stats.acc.utaroFamilies}
            sub={`${stats.acc.utaroPeople} people`}
            active={isActive({ kind: "acc", value: "utaro", label: "" })}
            onClick={() => toggleFilter({ kind: "acc", value: "utaro", label: "Utaro" })}
          />
          <StatButton
            label="Awaiting utaro"
            value={stats.acc.awaitingFamilies}
            sub={`${stats.acc.awaitingPeople} people — hotel booked, open to a host`}
            active={isActive({ kind: "awaiting_utaro", label: "" })}
            onClick={() => toggleFilter({ kind: "awaiting_utaro", label: "Awaiting utaro" })}
          />
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">By hotel</h3>
            {stats.hotels.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">No hotel registrations yet.</p>
            ) : (
              <div className="space-y-3">
                {stats.hotels.map((h) => (
                  <ClickableBar
                    key={h.key}
                    label={h.label}
                    value={h.families}
                    sub={`${h.people} people`}
                    max={Math.max(1, ...stats.hotels.map((x) => x.families))}
                    color="bg-blue-500"
                    active={isActive({ kind: "hotel", value: h.key, label: "" })}
                    onClick={() => toggleFilter({ kind: "hotel", value: h.key, label: h.label })}
                    trailing={
                      h.awaitingFamilies > 0 ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFilter({ kind: "hotel_awaiting", value: h.key, label: `${h.label} — awaiting utaro` });
                          }}
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            isActive({ kind: "hotel_awaiting", value: h.key, label: "" })
                              ? "bg-amber-500 text-white"
                              : "bg-amber-100 text-amber-800 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-300"
                          }`}
                          title={`${h.awaitingFamilies} families (${h.awaitingPeople} people) at ${h.label} awaiting utaro`}
                        >
                          {h.awaitingFamilies} awaiting
                        </button>
                      ) : null
                    }
                  />
                ))}
              </div>
            )}
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
              Hosts (as reported by guests)
            </h3>
            {stats.hosts.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">No utaro registrations yet.</p>
            ) : (
              <div className="space-y-3">
                {stats.hosts.map((h) => (
                  <ClickableBar
                    key={h.key}
                    label={h.label}
                    value={h.families}
                    sub={`${h.people} people`}
                    max={Math.max(1, ...stats.hosts.map((x) => x.families))}
                    color="bg-green-500"
                    active={isActive({ kind: "host", value: h.key, label: "" })}
                    onClick={() => toggleFilter({ kind: "host", value: h.key, label: h.label })}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </Panel>

      {/* ---- Transport (Parking) ---- */}
      <Panel title="Transport (counted by household)">
        <div className="space-y-3">
          {stats.transport.map((t) => (
            <ClickableBar
              key={t.mode}
              label={TRANSPORT_LABELS[t.mode]}
              value={t.families}
              sub={`${t.people} people`}
              max={Math.max(1, ...stats.transport.map((x) => x.families))}
              color="bg-purple-500"
              active={isActive({ kind: "transport", value: t.mode, label: "" })}
              onClick={() => toggleFilter({ kind: "transport", value: t.mode, label: TRANSPORT_LABELS[t.mode] })}
            />
          ))}
        </div>
      </Panel>

      {/* ---- Registrations table ---- */}
      <Panel title={`Families (${visible.length})`}>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or ITS…"
            className="w-full max-w-xs rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          />
          {filter ? (
            <span className="flex items-center gap-1 rounded-full bg-blue-100 px-3 py-1 text-sm text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
              {filter.label}
              <button type="button" onClick={() => setFilter(null)} aria-label="Clear filter" className="ml-1 font-bold hover:text-blue-600">
                ×
              </button>
            </span>
          ) : (
            <span className="text-sm text-gray-500 dark:text-gray-400">Showing submitted + confirmed</span>
          )}
          <button
            type="button"
            onClick={downloadCsv}
            disabled={visible.length === 0}
            className="ml-auto rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Download CSV{memberFlag ? " (members)" : ""}
          </button>
        </div>

        {visible.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">No families match.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  <th className="w-8 py-2" />
                  <th className="py-2 pr-3">Family (HOF)</th>
                  <th className="py-2 pr-3">People</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Accommodation</th>
                  <th className="py-2 pr-3">Transport</th>
                </tr>
              </thead>
              <tbody>
                {visible.slice(0, MAX_TABLE_ROWS).map((f) => {
                  const isOpen = Boolean(memberFlag) || expanded.has(f.id);
                  const shown = membersFor(f);
                  return (
                    <FamilyRows
                      key={f.id}
                      family={f}
                      members={shown}
                      open={isOpen}
                      onToggle={() => toggleExpanded(f.id)}
                      forceOpen={Boolean(memberFlag)}
                    />
                  );
                })}
              </tbody>
            </table>
            {visible.length > MAX_TABLE_ROWS ? (
              <p className="mt-3 text-center text-sm text-amber-700 dark:text-amber-400">
                Showing first {MAX_TABLE_ROWS} of {visible.length} families — refine the search or filter. CSV export includes all {visible.length}.
              </p>
            ) : null}
          </div>
        )}
      </Panel>
    </main>
  );
}

function FamilyRows({
  family: f,
  members,
  open,
  onToggle,
  forceOpen,
}: {
  family: Family;
  members: MemberRow[];
  open: boolean;
  onToggle: () => void;
  forceOpen: boolean;
}) {
  const accommodation =
    f.acc_type === "hotel" ? (
      <span>
        Hotel: {f.hotel_name ?? "—"}
        {f.open_to_utaro ? (
          <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
            awaiting utaro
          </span>
        ) : null}
      </span>
    ) : f.acc_type === "utaro" ? (
      <span>Utaro: {f.utaro_host_name ?? "—"}</span>
    ) : (
      <span className="text-gray-400">—</span>
    );

  const transport = f.transport_mode ? (
    <span title={f.transport_detail ?? undefined}>{TRANSPORT_LABELS[f.transport_mode]}</span>
  ) : (
    <span className="text-gray-400">—</span>
  );

  return (
    <>
      <tr className="border-b dark:border-gray-800">
        <td className="py-2">
          {!forceOpen ? (
            <button
              type="button"
              onClick={onToggle}
              aria-label={open ? "Collapse members" : "Expand members"}
              className="text-gray-400 hover:text-blue-600 dark:hover:text-blue-400"
            >
              {open ? "▾" : "▸"}
            </button>
          ) : null}
        </td>
        <td className="py-2 pr-3">
          <p className="font-medium dark:text-gray-100">{f.hofName ?? "(Name unknown)"}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">ITS {f.hof_its}</p>
        </td>
        <td className="py-2 pr-3">{f.size}</td>
        <td className="py-2 pr-3">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[f.registration_status]}`}>
            {STATUS_LABELS[f.registration_status]}
          </span>
        </td>
        <td className="py-2 pr-3">{accommodation}</td>
        <td className="py-2 pr-3">{transport}</td>
      </tr>
      {open && members.length > 0 ? (
        <tr className="border-b bg-gray-50 dark:border-gray-800 dark:bg-gray-800/40">
          <td />
          <td colSpan={5} className="py-2 pr-3">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left uppercase text-gray-400">
                  <th className="py-1 pr-3">Name</th>
                  <th className="py-1 pr-3">ITS</th>
                  <th className="py-1 pr-3">Age</th>
                  <th className="py-1 pr-3">Gender</th>
                  <th className="py-1 pr-3">Local/Mehman</th>
                  <th className="py-1 pr-3">Needs</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.its}>
                    <td className="py-1 pr-3 dark:text-gray-200">{m.full_name ?? "—"}</td>
                    <td className="py-1 pr-3 text-gray-500 dark:text-gray-400">{m.its}</td>
                    <td className="py-1 pr-3">{m.age ?? "—"}</td>
                    <td className="py-1 pr-3">{m.gender ?? "—"}</td>
                    <td className="py-1 pr-3">{m.local_mehman ?? "—"}</td>
                    <td className="py-1 pr-3">
                      {[
                        m.rahat_seating ? "Rahat" : null,
                        m.wheelchair ? "Wheelchair" : null,
                        m.special_needs?.trim() ? m.special_needs.trim() : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <h2 className="mb-4 text-lg font-semibold dark:text-gray-100">{title}</h2>
      {children}
    </div>
  );
}

function ReadonlyMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-800/50">
      <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">{value}</p>
    </div>
  );
}

function StatButton({
  label,
  value,
  sub,
  active,
  onClick,
}: {
  label: string;
  value: number;
  sub?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border p-4 text-left shadow-sm transition ${
        active
          ? "border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-900/20"
          : "border-gray-200 bg-white hover:border-blue-300 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-blue-700"
      }`}
    >
      <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{sub}</p> : null}
    </button>
  );
}

function ClickableBar({
  label,
  value,
  sub,
  max,
  color,
  active,
  onClick,
  trailing,
}: {
  label: string;
  value: number;
  sub?: string;
  max: number;
  color: string;
  active: boolean;
  onClick: () => void;
  trailing?: React.ReactNode;
}) {
  return (
    <div className={`-mx-2 rounded-md px-2 py-1 ${active ? "bg-blue-50 dark:bg-blue-900/20" : ""}`}>
      <div className="mb-1 flex items-center justify-between gap-3 text-sm">
        <button
          type="button"
          onClick={onClick}
          className="truncate text-left font-medium hover:text-blue-600 dark:text-gray-200 dark:hover:text-blue-400"
        >
          {label}
        </button>
        <span className="flex shrink-0 items-center gap-2 text-gray-500 dark:text-gray-400">
          {trailing}
          <span>{sub ? `${value} (${sub})` : value}</span>
        </span>
      </div>
      <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-700">
        <div
          className={`h-2 rounded-full ${color}`}
          style={{ width: `${Math.max(value === 0 ? 0 : 4, (value / max) * 100)}%` }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Lint + build**

Run: `npm run lint` then `npm run build`
Expected: both pass. (`next build` is the type-check; there is no separate `tsc` script.)

- [ ] **Step 3: Manual verification in the browser**

Run `npm run dev`, sign in at `/admin/login`, open `/admin/registrations`. Check:
1. Nav shows "Registrations" under External; page loads with stats + table.
2. Funnel family counts match the stats cards on `/admin/mumineen` (Registered families ≈ submitted+confirmed, Cancelled matches).
3. Click "Hotel" stat → table filters; chip appears; click × → back to default.
4. Click a hotel's "N awaiting" badge → only that hotel's open-to-utaro families.
5. Click "Wheelchair" → rows force-expand to matching members only; CSV button says "(members)".
6. Download CSV with and without a member filter; open both — headers + rows look right, quoted fields intact.
7. Search by a known member name (non-HOF) → their family appears.
8. Dark mode toggle — page remains readable.
9. Sign in as (or simulate) a non-admin `is_manager` user: page accessible; a plain committee user without `is_manager` is redirected to `/admin/conversations`.

Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/registrations/page.tsx
git commit -m "Registrations: department-facing page - filterable stats over family/member table with CSV export"
```

---

### Task 5: Final verification + push

- [ ] **Step 1: Full test suite, lint, build**

Run: `npm run test && npm run lint && npm run build`
Expected: all pass.

- [ ] **Step 2: Push**

```bash
git push
```

(Direct to `main` per team convention; local git config already uses the noreply email.)

---

## Spec coverage map

| Spec requirement | Task |
|---|---|
| `canViewRegistrations` access + nav entry | 1 |
| One API returning row-level families + members, paged, `roster_active`/`not_attending` filters | 3 |
| Client-side aggregation, instant filtering | 2 (logic) + 4 (wiring) |
| Funnel (all statuses incl. cancelled) → filters table | 2, 4 |
| Demographics: local/mehman, M/F, kids/adults/seniors (65+), rahat/wheelchair/special | 2, 4 |
| Hotel vs utaro, awaiting-utaro pool, per-hotel breakdown w/ inline awaiting counts (both clickable) | 2, 4 |
| Hosts view derived from guest-entered host ITS/name | 2, 4 |
| Transport by household + people, incl. unspecified | 2, 4 |
| Searchable expandable table; member filters auto-expand to matches | 4 |
| Dismissible filter chip | 4 |
| CSV export of current filtered view (family or member level) | 2, 4 |
| Default population submitted+confirmed; funnel shows all | 2, 4 |
| Read-only; `/admin/mumineen` untouched | all |
| Manual verification vs `/admin/mumineen` stats | 4, 5 |
