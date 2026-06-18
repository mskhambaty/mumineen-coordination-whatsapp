import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveFamilyForPhone = vi.fn();
const getFamilyMembers = vi.fn();
const getFamilyNiyazDays = vi.fn();
const groupEventsByDay = vi.fn();
const markFamilyRsvpConfirmed = vi.fn();
const setFamilyNiyazRsvp = vi.fn();
const getUnregisteredRsvps = vi.fn();
const recordUnregisteredRsvp = vi.fn();
const getEvents = vi.fn();
const getEventConfigTitles = vi.fn();
const getClosedEventDates = vi.fn();

vi.mock("@/lib/rsvp/family", () => ({
  resolveFamilyForPhone: (...args: unknown[]) => resolveFamilyForPhone(...args),
}));
vi.mock("@/lib/rsvp/meal-rsvp", () => ({
  getFamilyMembers: (...args: unknown[]) => getFamilyMembers(...args),
  getFamilyNiyazDays: (...args: unknown[]) => getFamilyNiyazDays(...args),
  groupEventsByDay: (...args: unknown[]) => groupEventsByDay(...args),
  markFamilyRsvpConfirmed: (...args: unknown[]) => markFamilyRsvpConfirmed(...args),
  setFamilyNiyazRsvp: (...args: unknown[]) => setFamilyNiyazRsvp(...args),
  getUnregisteredRsvps: (...args: unknown[]) => getUnregisteredRsvps(...args),
  recordUnregisteredRsvp: (...args: unknown[]) => recordUnregisteredRsvp(...args),
  getEvents: (...args: unknown[]) => getEvents(...args),
}));
vi.mock("@/lib/rsvp/event-config", () => ({
  getEventConfigTitles: (...args: unknown[]) => getEventConfigTitles(...args),
  getClosedEventDates: (...args: unknown[]) => getClosedEventDates(...args),
}));

import { GET, POST } from "@/app/api/rsvp/meals/route";

const PHONE = "+15551234567";
const FAMILY = { familyId: "fam-1", muminId: "m-1", hofIts: "10", displayName: "X" };

// The route filters out past events, so these tests must use an "upcoming" date relative to the
// run (not a hardcoded one that lapses). Label is computed the same way the route does.
const UPCOMING = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const UPCOMING_LABEL = new Date(`${UPCOMING}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
const PAST = "2020-01-01"; // always before today → must be filtered out

function req(method: string, body?: unknown, withPhone = true): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (withPhone) headers["x-whatsapp-from"] = PHONE;
  return new NextRequest("http://localhost/api/rsvp/meals", {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const MEMBERS = [
  { name: "Head Person", isAdult: true, isHead: true, notAttending: false },
  { name: "Spouse Person", isAdult: true, isHead: false, notAttending: false },
  { name: "Kid Person", isAdult: false, isHead: false, notAttending: false },
];

const day = (over: Record<string, unknown> = {}) => ({
  date: UPCOMING,
  title: "1st Moharram ul Haram",
  hijriDate: null,
  lunch: { attending: 4, total: 5 },
  dinner: { attending: 4, total: 5 },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  markFamilyRsvpConfirmed.mockResolvedValue(undefined);
  getFamilyMembers.mockResolvedValue(MEMBERS);
  getEventConfigTitles.mockResolvedValue(new Map());
  getClosedEventDates.mockResolvedValue(new Map());
});

describe("GET /api/rsvp/meals", () => {
  it("rejects a request with no x-whatsapp-from header (unauthorized)", async () => {
    const res = await GET(req("GET", undefined, false));
    expect(res.status).toBe(400);
    expect(resolveFamilyForPhone).not.toHaveBeenCalled();
  });

  it("returns the caller's family per-day rows (title + dateLabel + lunch/dinner counts)", async () => {
    resolveFamilyForPhone.mockResolvedValue(FAMILY);
    // One past day (must be dropped) + one upcoming day.
    getFamilyNiyazDays.mockResolvedValue([day({ date: PAST }), day()]);
    const res = await GET(req("GET"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("ok");
    // Past day filtered out; only the upcoming day remains.
    expect(json.days).toHaveLength(1);
    expect(json.days[0].title).toBe("1st Moharram ul Haram");
    // The label is computed server-side (so the agent never guesses it) and includes the weekday.
    expect(json.days[0].dateLabel).toBe(UPCOMING_LABEL);
    expect(json.days[0].lunch.attending).toBe(4);
    expect(json.days[0].dinner.attending).toBe(4);
    expect(json.familyMembers).toEqual(MEMBERS);
    expect(getFamilyNiyazDays).toHaveBeenCalledWith("fam-1");
    // Viewing the RSVP via the bot promotes default rows to whatsapp for the min view.
    expect(markFamilyRsvpConfirmed).toHaveBeenCalledWith("fam-1", PHONE);
  });

  it("flags a day whose RSVP cutoff has passed as closed", async () => {
    resolveFamilyForPhone.mockResolvedValue(FAMILY);
    getFamilyNiyazDays.mockResolvedValue([day()]);
    getClosedEventDates.mockResolvedValue(
      new Map([[UPCOMING, { endAt: "2020-01-01T00:00:00.000Z", title: "1st Moharram ul Haram" }]]),
    );
    const res = await GET(req("GET"));
    const json = await res.json();
    expect(json.days[0].closed).toBe(true);
    expect(json.days[0].closedAt).toBe("2020-01-01T00:00:00.000Z");
  });

  it("marks an open day as not closed", async () => {
    resolveFamilyForPhone.mockResolvedValue(FAMILY);
    getFamilyNiyazDays.mockResolvedValue([day()]);
    const res = await GET(req("GET"));
    const json = await res.json();
    expect(json.days[0].closed).toBe(false);
    expect(json.days[0].closedAt).toBeNull();
  });

  it("renders a single-meal day with the other meal null (e.g. Ashura dinner-only)", async () => {
    resolveFamilyForPhone.mockResolvedValue(FAMILY);
    getFamilyNiyazDays.mockResolvedValue([
      day({ title: "10th Moharram ul Haram (Ashura)", lunch: null }),
    ]);
    const res = await GET(req("GET"));
    const json = await res.json();
    expect(json.days[0].lunch).toBeNull();
    expect(json.days[0].dinner.attending).toBe(4);
  });

  it("returns unregistered with a per-DAY events list (date, dateLabel, title, meal booleans)", async () => {
    resolveFamilyForPhone.mockResolvedValue(null);
    getUnregisteredRsvps.mockResolvedValue([]);
    getEvents.mockResolvedValue([
      { id: "e1", title: "1st Moharram ul Haram", eventDate: UPCOMING, meal: "lunch" },
      { id: "e2", title: "2nd Moharram ul Haram", eventDate: UPCOMING, meal: "dinner" },
    ]);
    groupEventsByDay.mockReturnValue([
      { date: UPCOMING, title: "1st Moharram ul Haram", hijriDate: null, lunch: true, dinner: true },
    ]);
    const res = await GET(req("GET"));
    const json = await res.json();
    expect(json.status).toBe("unregistered");
    expect(json.events).toEqual([
      { date: UPCOMING, dateLabel: UPCOMING_LABEL, title: "1st Moharram ul Haram", lunch: true, dinner: true, closed: false, closedAt: null, closedLabel: null },
    ]);
    expect(getFamilyNiyazDays).not.toHaveBeenCalled();
  });
});

describe("POST /api/rsvp/meals", () => {
  it("rejects with no x-whatsapp-from header", async () => {
    const res = await POST(req("POST", { entries: [{ attending: false, dates: ["2026-06-16"] }] }, false));
    expect(res.status).toBe(400);
    expect(setFamilyNiyazRsvp).not.toHaveBeenCalled();
  });

  it("rejects an invalid body (entry missing attending)", async () => {
    resolveFamilyForPhone.mockResolvedValue(FAMILY);
    const res = await POST(req("POST", { entries: [{ dates: ["2026-06-16"] }] }));
    expect(res.status).toBe(400);
    expect(setFamilyNiyazRsvp).not.toHaveBeenCalled();
  });

  it("records an unregistered RSVP (entries + adults/its) when the number isn't on the roster", async () => {
    resolveFamilyForPhone.mockResolvedValue(null);
    recordUnregisteredRsvp.mockResolvedValue({ upserted: 4 });
    getUnregisteredRsvps.mockResolvedValue([]);
    const entries = [
      { attending: true, all: true },
      { attending: false, dates: ["2026-06-15"], meal: "lunch" },
    ];
    const res = await POST(req("POST", { entries, adults: 2, its_number: "30711842" }));
    const json = await res.json();
    expect(json.status).toBe("unregistered_recorded");
    expect(json.updated).toBe(4);
    expect(recordUnregisteredRsvp).toHaveBeenCalledWith({
      phone: PHONE,
      entries,
      adults: 2,
      kids: undefined,
      itsNumber: "30711842",
    });
    expect(setFamilyNiyazRsvp).not.toHaveBeenCalled();
  });

  it("applies a date+meal change for the whole family and returns the refreshed per-day rows", async () => {
    resolveFamilyForPhone.mockResolvedValue(FAMILY);
    setFamilyNiyazRsvp.mockResolvedValue({ updated: 5, grid: [] });
    getFamilyNiyazDays.mockResolvedValue([day({ dinner: { attending: 0, total: 5 } })]);
    const res = await POST(req("POST", { entries: [{ attending: false, dates: [UPCOMING], meal: "dinner" }] }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("ok");
    expect(json.updated).toBe(5);
    // POST returns the same per-day shape as GET (not the legacy grid).
    expect(json.days).toHaveLength(1);
    expect(json.days[0].dinner.attending).toBe(0);
    expect(json.days[0].dateLabel).toBe(UPCOMING_LABEL);
    expect(setFamilyNiyazRsvp).toHaveBeenCalledWith(
      "fam-1",
      [{ attending: false, titles: undefined, dates: [UPCOMING], meal: "dinner", all: undefined }],
      { source: "whatsapp", phone: PHONE },
      undefined,
    );
  });

  it("passes partial counts (adults/kids) through for registered families", async () => {
    resolveFamilyForPhone.mockResolvedValue(FAMILY);
    setFamilyNiyazRsvp.mockResolvedValue({ updated: 3, grid: [] });
    getFamilyNiyazDays.mockResolvedValue([]);
    const res = await POST(req("POST", {
      entries: [{ attending: true, dates: ["2026-06-21"], meal: "dinner" }],
      adults: 1,
      kids: 0,
    }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("ok");
    expect(setFamilyNiyazRsvp).toHaveBeenCalledWith(
      "fam-1",
      [{ attending: true, titles: undefined, dates: ["2026-06-21"], meal: "dinner", all: undefined }],
      { source: "whatsapp", phone: PHONE },
      { adults: 1, kids: 0 },
    );
  });

  it("still passes title-targeted entries through (legacy fallback)", async () => {
    resolveFamilyForPhone.mockResolvedValue(FAMILY);
    setFamilyNiyazRsvp.mockResolvedValue({ updated: 3, grid: [] });
    getFamilyNiyazDays.mockResolvedValue([]);
    const res = await POST(req("POST", {
      entries: [{ attending: false, titles: ["Pehli Raat"], meal: "dinner" }],
    }));
    expect(res.status).toBe(200);
    expect(setFamilyNiyazRsvp).toHaveBeenCalledWith(
      "fam-1",
      [{ attending: false, titles: ["Pehli Raat"], dates: undefined, meal: "dinner", all: undefined }],
      { source: "whatsapp", phone: PHONE },
      undefined,
    );
  });

  it("surfaces a clamp notice (with a message) when the count exceeded the family size", async () => {
    resolveFamilyForPhone.mockResolvedValue(FAMILY);
    setFamilyNiyazRsvp.mockResolvedValue({
      updated: 3,
      grid: [],
      clamped: { requestedAdults: 6, requestedKids: undefined, maxAdults: 2, maxKids: 1 },
    });
    getFamilyNiyazDays.mockResolvedValue([]);
    const res = await POST(req("POST", {
      entries: [{ attending: true, all: true }],
      adults: 6,
    }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("ok");
    expect(json.clamped.maxAdults).toBe(2);
    expect(json.clamped.requestedAdults).toBe(6);
    expect(json.clamped.message).toMatch(/capped|own phones/i);
  });
});
