import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { resolveFamilyForPhone } from "@/lib/rsvp/family";
import { getFamilyMembers, getFamilyNiyazGrid, markFamilyRsvpConfirmed, setFamilyNiyazRsvp, getUnregisteredRsvps, recordUnregisteredRsvp, getEvents } from "@/lib/rsvp/meal-rsvp";

export const runtime = "nodejs";

// Niyaz RSVP for the caller's own family. Identified (and authorized) by x-whatsapp-from: a caller
// can only read/write their own family's grid. Used by the agent's get/set meal-RSVP tools.
// Attendance is pre-seeded from arrival dates, so the agent mainly records changes (e.g. "we're not
// coming on the 16th"). A change cascades to the whole family for the matched event(s).

const entrySchema = z.object({
  attending: z.boolean(),
  dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  meal: z.enum(["lunch", "dinner"]).optional(),
  all: z.boolean().optional(),
});

const postSchema = z.object({
  entries: z.array(entrySchema).min(1).max(60),
  adults: z.number().int().min(0).optional(),
  kids: z.number().int().min(0).optional(),
  its_number: z.string().optional(),
});

function requirePhone(req: NextRequest): string | null {
  const phone = req.headers.get("x-whatsapp-from");
  return phone && phone.trim() ? phone.trim() : null;
}

// Today in America/Chicago as YYYY-MM-DD — events on or after this date are "upcoming".
function todayChicago(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

// Human date label with the weekday for an event's YYYY-MM-DD date, e.g. "Sat, Jun 14". Computed
// server-side (at UTC noon, formatted in UTC) so it's deterministic and the agent never has to work
// out a weekday itself — it just echoes this label in the RSVP summary it reads back to the user.
function dateLabel(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
}

// GET — the caller's family Niyaz grid (every event + how many of the family are attending).
// Returns status "unregistered" with existing unregistered RSVPs if the phone isn't linked.
export async function GET(req: NextRequest) {
  const phone = requirePhone(req);
  if (!phone) return NextResponse.json({ error: "Missing x-whatsapp-from header" }, { status: 400 });

  const today = todayChicago();

  const family = await resolveFamilyForPhone(phone);
  if (!family) {
    const [rsvps, events] = await Promise.all([getUnregisteredRsvps(phone), getEvents()]);
    const upcoming = events.filter((e) => e.eventDate >= today);
    return NextResponse.json({
      status: "unregistered",
      grid: [],
      events: upcoming.map((e) => ({ date: e.eventDate, label: dateLabel(e.eventDate), meal: e.meal, title: e.title })),
      rsvps: rsvps.filter((r) => r.event_date >= today),
      message: "This number isn't linked to a registered family. Any previous RSVPs from this number are shown in rsvps. Use events for the canonical date/meal/title of each jaman.",
    });
  }

  const [grid, familyMembers] = await Promise.all([
    getFamilyNiyazGrid(family.familyId),
    getFamilyMembers(family.familyId),
  ]);
  markFamilyRsvpConfirmed(family.familyId, phone).catch(() => {});
  const labeledGrid = grid
    .filter((row) => row.event.eventDate >= today)
    .map((row) => ({ ...row, dateLabel: dateLabel(row.event.eventDate) }));
  return NextResponse.json({ status: "ok", grid: labeledGrid, familyMembers });
}

// POST — set RSVP for the caller's family across one or more days/meals.
// For unregistered callers: records into unregistered_rsvps with optional adults/kids/its_number.
export async function POST(req: NextRequest) {
  const phone = requirePhone(req);
  if (!phone) return NextResponse.json({ error: "Missing x-whatsapp-from header" }, { status: 400 });

  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  }

  const family = await resolveFamilyForPhone(phone);
  if (!family) {
    const { upserted } = await recordUnregisteredRsvp({
      phone,
      entries: parsed.data.entries,
      adults: parsed.data.adults,
      kids: parsed.data.kids,
      itsNumber: parsed.data.its_number,
    });
    const rsvps = await getUnregisteredRsvps(phone);
    return NextResponse.json({ status: "unregistered_recorded", updated: upserted, rsvps });
  }

  const partial = parsed.data.adults !== undefined || parsed.data.kids !== undefined
    ? { adults: parsed.data.adults, kids: parsed.data.kids }
    : undefined;

  const result = await setFamilyNiyazRsvp(
    family.familyId,
    parsed.data.entries.map((e) => ({ attending: e.attending, dates: e.dates, meal: e.meal, all: e.all })),
    { source: "whatsapp", phone },
    partial,
  );

  // If the requested counts exceeded the family size, tell the agent so it can explain to the user
  // that we capped at their registered family and the extras must register from their own phones.
  const clampNotice = result.clamped
    ? {
        ...result.clamped,
        message:
          "The number of attendees you set is higher than this family's registered size, so it was capped at the family's actual members. The additional people must message this number from their own phones to register and RSVP separately.",
      }
    : undefined;

  return NextResponse.json({ status: "ok", updated: result.updated, grid: result.grid, clamped: clampNotice });
}
