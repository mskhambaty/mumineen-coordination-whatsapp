import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requirePortalCaller = vi.fn();
const getSupabaseAdmin = vi.fn();

vi.mock("@/lib/api/portal-auth", () => ({
  requirePortalCaller: (...a: unknown[]) => requirePortalCaller(...a),
}));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => getSupabaseAdmin(),
}));

import { GET } from "@/app/api/admin/registration-analytics/detail/route";

// A chainable stub for `from(table).select(...).eq(...).range(from,to)` used by fetchAll.
// fetchAll requests range(0, 999) first and stops once a page returns < 1000 rows, so we
// return the full row set on the first page and an empty page afterwards.
function makeChain(rows: unknown[]) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    range: (from: number) => Promise.resolve({ data: from === 0 ? rows : [] }),
  };
  return chain;
}

function stubSupabase(tables: Record<string, unknown[]>) {
  return { from: (table: string) => makeChain(tables[table] ?? []) };
}

const FAMILIES = [
  // Registered + hotel + open: included. HoF (100) is in the roster → natural head.
  { hof_its: "100", registration_status: "submitted", acc_type: "hotel", hotel_name: "Hyatt", open_to_utaro: true, submitted_by_its: "100" },
  // Registered + hotel + open: included. HoF (200) NOT in roster → registrant 201 is acting head.
  { hof_its: "200", registration_status: "submitted", acc_type: "hotel", hotel_name: "Hilton", open_to_utaro: true, submitted_by_its: "201" },
  // Not open to a host → excluded.
  { hof_its: "300", registration_status: "submitted", acc_type: "hotel", hotel_name: "Westin", open_to_utaro: false, submitted_by_its: "300" },
  // Not registered → excluded.
  { hof_its: "400", registration_status: "not_started", acc_type: "hotel", hotel_name: "Marriott", open_to_utaro: true, submitted_by_its: null },
];

const MUMINEEN = [
  { its: "100", hof_its: "100", is_head: true, gender: "M", age: 40, not_attending: false, full_name: "Head One", local_mehman: "Mehman", whatsapp_e164: "+15550000100", email: "h1@x.com" },
  { its: "101", hof_its: "100", is_head: false, gender: "F", age: 38, not_attending: false, full_name: "Spouse One", local_mehman: "Mehman", whatsapp_e164: null, email: null },
  { its: "102", hof_its: "100", is_head: false, gender: "M", age: 10, not_attending: true, full_name: "Child One", local_mehman: "Mehman", whatsapp_e164: null, email: null },
  { its: "201", hof_its: "200", is_head: false, gender: "F", age: 35, not_attending: false, full_name: "Acting Two", local_mehman: "Mehman", whatsapp_e164: null, email: null },
  { its: "202", hof_its: "200", is_head: false, gender: "M", age: 5, not_attending: false, full_name: "Child Two", local_mehman: "Mehman", whatsapp_e164: null, email: null },
  { its: "300", hof_its: "300", is_head: true, gender: "M", age: 50, not_attending: false, full_name: "Head Three", local_mehman: "Local", whatsapp_e164: null, email: null },
  { its: "401", hof_its: "400", is_head: false, gender: "F", age: 30, not_attending: false, full_name: "Member Four", local_mehman: "Mehman", whatsapp_e164: null, email: null },
];

function req(query = "segment=open_to_utaro") {
  return new NextRequest(`http://localhost/api/admin/registration-analytics/detail?${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  getSupabaseAdmin.mockReturnValue(stubSupabase({ families: FAMILIES, mumineen: MUMINEEN }));
  requirePortalCaller.mockResolvedValue({ role: "admin" });
});

describe("GET /api/admin/registration-analytics/detail — open_to_utaro", () => {
  it("returns individual rows for every member of qualifying families, with gender/age populated", async () => {
    const json = await (await GET(req())).json();

    // Only families 100 (3 members) and 200 (2 members) qualify; 300 (not open) and 400 (not registered) are excluded.
    expect(json.count).toBe(5);
    expect(json.rows.map((r: { its: string }) => r.its).sort()).toEqual(["100", "101", "102", "201", "202"]);
    expect(json.rows.some((r: { its: string }) => r.its === "300" || r.its === "401")).toBe(false);

    const head = json.rows.find((r: { its: string }) => r.its === "100");
    expect(head).toMatchObject({ gender: "M", age: "40", attending: "Yes", detail: "Hyatt", hof_its: "100", head: "Head" });
  });

  it("flags the registrant as 'Acting head' when the family head is not in the roster", async () => {
    const rows = (await (await GET(req())).json()).rows as { its: string; hof_its: string; head: string }[];

    // Family 200 has no is_head member; submitted_by_its (201) becomes the acting head.
    const acting = rows.find((r) => r.its === "201");
    expect(acting?.head).toBe("Acting head");
    // Exactly one head marked per family.
    expect(rows.filter((r) => r.hof_its === "100" && r.head).length).toBe(1);
    expect(rows.filter((r) => r.hof_its === "200" && r.head).length).toBe(1);
  });

  it("includes not-attending members and calls them out via the Attending column", async () => {
    const rows = (await (await GET(req())).json()).rows as { its: string; attending: string }[];
    expect(rows.find((r) => r.its === "102")?.attending).toBe("No");
    expect(rows.find((r) => r.its === "101")?.attending).toBe("Yes");
  });

  it("narrows to a single hotel when a value is supplied", async () => {
    const json = await (await GET(req("segment=open_to_utaro&value=Hilton"))).json();
    expect(json.rows.every((r: { hof_its: string }) => r.hof_its === "200")).toBe(true);
    expect(json.count).toBe(2);
  });

  it("returns the auth response when the caller is not permitted", async () => {
    requirePortalCaller.mockResolvedValue(NextResponse.json({ error: "forbidden" }, { status: 403 }));
    const res = await GET(req());
    expect(res.status).toBe(403);
  });
});

describe("GET /api/admin/registration-analytics/detail — registration_status drill", () => {
  const STATUS_FAMILIES = [
    { hof_its: "900", registration_status: "not_started", acc_type: null, hotel_name: null, open_to_utaro: null, submitted_by_its: null },
    { hof_its: "901", registration_status: "submitted", acc_type: "hotel", hotel_name: "Hyatt", open_to_utaro: false, submitted_by_its: "901" },
  ];
  const STATUS_MUMINEEN = [
    { its: "900", hof_its: "900", is_head: true, full_name: "Pending Head", local_mehman: "Mehman", whatsapp_e164: null, not_attending: false },
    { its: "900b", hof_its: "900", is_head: false, full_name: "Pending Spouse", local_mehman: "Mehman", whatsapp_e164: null, not_attending: true },
    { its: "901", hof_its: "901", is_head: true, full_name: "Registered Head", local_mehman: "Mehman", whatsapp_e164: null, not_attending: false },
  ];

  beforeEach(() => {
    getSupabaseAdmin.mockReturnValue(stubSupabase({ families: STATUS_FAMILIES, mumineen: STATUS_MUMINEEN }));
  });

  it("returns pending families with the FULL family size and no status detail", async () => {
    // Regression: the funnel counts not_started as pending, so the pending drill must too.
    const json = await (await GET(req("segment=registration_status&value=pending"))).json();
    expect(json.rows.map((r: { hof_its: string }) => r.hof_its)).toEqual(["900"]);
    expect(json.count).toBe(1);
    // Pending family hasn't registered → show full family size (2 members), not attending count.
    expect(json.rows[0].attending).toBe("2");
    // No status column for pending families.
    expect(json.rows[0].detail).toBe("");
  });

  it("returns registered families with the attending headcount and a submitted-date detail", async () => {
    const json = await (await GET(req("segment=registration_status&value=submitted"))).json();
    expect(json.rows.map((r: { hof_its: string }) => r.hof_its)).toEqual(["901"]);
    expect(json.count).toBe(1);
    // Registered family 901 has 1 attending member.
    expect(json.rows[0].attending).toBe("1");
    expect(json.rows[0].detail).toMatch(/^Submitted/);
  });

  it("all_families returns one row per active family (registered + pending) at the family level", async () => {
    const json = await (await GET(req("segment=all_families"))).json();
    // Both families, one row each — family-level (head/acting-head), not per-member.
    expect(json.rows.map((r: { hof_its: string }) => r.hof_its).sort()).toEqual(["900", "901"]);
    expect(json.count).toBe(2);
    const pending = json.rows.find((r: { hof_its: string }) => r.hof_its === "900");
    const reg = json.rows.find((r: { hof_its: string }) => r.hof_its === "901");
    // Pending: full family size, no status detail. Registered: attending count + submitted date.
    expect(pending).toMatchObject({ name: "Pending Head", attending: "2", detail: "" });
    expect(reg.attending).toBe("1");
    expect(reg.detail).toMatch(/^Submitted/);
  });
});

describe("GET /api/admin/registration-analytics/detail — registered_member (welcome team)", () => {
  const RM_FAMILIES = [
    { hof_its: "100", registration_status: "submitted", utaro_host_its: "HOST1" },
    { hof_its: "200", registration_status: "not_started", utaro_host_its: null }, // unregistered
  ];
  const RM_MUMINEEN = [
    { its: "100", hof_its: "100", full_name: "Reg Head", gender: "M", local_mehman: "Mehman", not_attending: false, whatsapp_e164: null, email: null, age: 40 },
    { its: "101", hof_its: "100", full_name: "Reg Kid", gender: "F", local_mehman: "Mehman", not_attending: true, whatsapp_e164: null, email: null, age: 8 }, // not attending
    { its: "201", hof_its: "200", full_name: "Pending", gender: "M", local_mehman: "Local", not_attending: false, whatsapp_e164: null, email: null, age: 50 }, // unregistered family
  ];

  beforeEach(() => {
    getSupabaseAdmin.mockReturnValue(stubSupabase({ families: RM_FAMILIES, mumineen: RM_MUMINEEN }));
  });

  it("lists only attending members of registered families, with HOF ITS, Host ITS and Age", async () => {
    const json = await (await GET(req("segment=registered_member"))).json();
    expect(json.rows.map((r: { its: string }) => r.its)).toEqual(["100"]);
    expect(json.rows[0]).toMatchObject({ hof_its: "100", utaro_host_its: "HOST1", local_mehman: "Mehman", gender: "M", age: "40" });
  });

  it("all_member lists EVERY member of EVERY active family (attending + not), with Age and an Attending flag", async () => {
    const json = await (await GET(req("segment=all_member"))).json();
    // 100 (registered, attending), 101 (not attending — now INCLUDED), 201 (unregistered family, attending).
    expect(json.rows.map((r: { its: string }) => r.its).sort()).toEqual(["100", "101", "201"]);
    const reg = json.rows.find((r: { its: string }) => r.its === "100");
    const notAttending = json.rows.find((r: { its: string }) => r.its === "101");
    const pending = json.rows.find((r: { its: string }) => r.its === "201");
    expect(reg).toMatchObject({ hof_its: "100", utaro_host_its: "HOST1", age: "40", attending: "Yes" });
    expect(notAttending).toMatchObject({ hof_its: "100", age: "8", attending: "No" });
    // Unregistered family has no host; its drilled row still appears with age + attending populated.
    expect(pending).toMatchObject({ hof_its: "200", age: "50", attending: "Yes" });
    expect(pending.utaro_host_its).toBeUndefined();
  });
});

describe("GET /api/admin/registration-analytics/detail — vip (VIP groups)", () => {
  const VIP_MUMINEEN = [
    { its: "1", hof_its: "1", is_head: true, full_name: "Zee", gender: "M", age: 40, local_mehman: "Mehman", not_attending: false, whatsapp_e164: null, email: null, category: "Baite Zainy", idara: null },
    { its: "2", hof_its: "2", is_head: true, full_name: "Aar", gender: "F", age: 35, local_mehman: "Local", not_attending: true, whatsapp_e164: null, email: null, category: "Baite Zainy", idara: null },
    { its: "3", hof_its: "3", is_head: true, full_name: "Qee", gender: "M", age: 50, local_mehman: "Mehman", not_attending: false, whatsapp_e164: null, email: null, category: null, idara: "Attalimiyah" }, // VIP via idara
    { its: "4", hof_its: "4", is_head: true, full_name: "Nope", gender: "M", age: 20, local_mehman: "Mehman", not_attending: false, whatsapp_e164: null, email: null, category: null, idara: "Muntasebeen" }, // not a VIP
  ];

  beforeEach(() => {
    getSupabaseAdmin.mockReturnValue(stubSupabase({ families: [], mumineen: VIP_MUMINEEN }));
  });

  it("lists members of one VIP group (category value), incl. not-attending, with the group in detail", async () => {
    const json = await (await GET(req("segment=vip&value=Baite%20Zainy"))).json();
    expect(json.rows.map((r: { its: string }) => r.its).sort()).toEqual(["1", "2"]);
    expect(json.rows.every((r: { detail: string }) => r.detail === "Baite Zainy")).toBe(true);
  });

  it("matches an idara-based VIP group", async () => {
    const json = await (await GET(req("segment=vip&value=Attalimiyah"))).json();
    expect(json.rows.map((r: { its: string }) => r.its)).toEqual(["3"]);
    expect(json.rows[0].detail).toBe("Attalimiyah");
  });

  it("with no value, lists ALL VIPs (category or qualifying idara), excluding non-VIPs", async () => {
    const json = await (await GET(req("segment=vip"))).json();
    expect(json.rows.map((r: { its: string }) => r.its).sort()).toEqual(["1", "2", "3"]);
  });
});
