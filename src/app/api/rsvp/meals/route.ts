import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getClosedEventDates, getEventConfigTitles } from "@/lib/rsvp/event-config";
import { formatNiyazEndTime } from "@/lib/rsvp/niyaz-format";
import { resolveFamilyForPhone } from "@/lib/rsvp/family";
import { getFamilyMembers, getFamilyNiyazDays, groupEventsByDay, markFamilyRsvpConfirmed, setFamilyNiyazRsvp, getUnregisteredRsvps, recordUnregisteredRsvp, getEvents } from "@/lib/rsvp/meal-rsvp";

export const runtime = "nodejs";

// Niyaz RSVP for the caller's own family. Identified (and authorized) by x-whatsapp-from: a caller
// can only read/write their own family's grid. Used by the agent's get/set meal-RSVP tools.
// Attendance is pre-seeded from arrival dates, so the agent mainly records changes (e.g. "we're not
// coming on the 16th"). A change cascades to the whole family for the matched event(s).

const entrySchema = z.object({
  attending: z.boolean(),
  titles: z.array(z.string().min(1)).optional(),
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

// GET — the caller's family Niyaz RSVP, organised per DAY (one row per Gregorian day, with a lunch
// and a dinner attending count). Returns status "unregistered" with existing unregistered RSVPs and
// the per-day event list if the phone isn't linked. Both are trimmed to today→Ashura.
export async function GET(req: NextRequest) {
  const phone = requirePhone(req);
  if (!phone) return NextResponse.json({ error: "Missing x-whatsapp-from header" }, { status: 400 });

  const today = todayChicago();

  const family = await resolveFamilyForPhone(phone);
  if (!family) {
    const [rsvps, events, titles, closed] = await Promise.all([getUnregisteredRsvps(phone), getEvents(), getEventConfigTitles(), getClosedEventDates(Date.now())]);
    const days = groupEventsByDay(events.filter((e) => e.eventDate >= today), titles).map((d) => {
      const c = closed.get(d.date);
      return {
        date: d.date,
        dateLabel: dateLabel(d.date),
        title: d.title,
        lunch: d.lunch,
        dinner: d.dinner,
        closed: Boolean(c),
        closedAt: c?.endAt ?? null,
        closedLabel: c ? formatNiyazEndTime(c.endAt) : null,
      };
    });
    return NextResponse.json({
      status: "unregistered",
      events: days,
      rsvps: rsvps.filter((r) => r.event_date >= today),
      message:
        "This number isn't linked to a registered family. Any previous RSVPs from this number are shown in rsvps. `events` is the canonical per-DAY jaman list (each with date, title, and which meals — lunch/dinner — are served); target a change by an event's date + meal.",
    });
  }

  const [days, familyMembers, closed] = await Promise.all([
    getFamilyNiyazDays(family.familyId),
    getFamilyMembers(family.familyId),
    getClosedEventDates(Date.now()),
  ]);
  markFamilyRsvpConfirmed(family.familyId, phone).catch(() => {});
  const labeled = days
    .filter((d) => d.date >= today)
    .map((d) => {
      const c = closed.get(d.date);
      return { ...d, dateLabel: dateLabel(d.date), closed: Boolean(c), closedAt: c?.endAt ?? null, closedLabel: c ? formatNiyazEndTime(c.endAt) : null };
    });
  return NextResponse.json({ status: "ok", days: labeled, familyMembers });
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
    const { upserted, blocked } = await recordUnregisteredRsvp({
      phone,
      entries: parsed.data.entries,
      adults: parsed.data.adults,
      kids: parsed.data.kids,
      itsNumber: parsed.data.its_number,
    });
    const rsvps = await getUnregisteredRsvps(phone);
    const blockedLabeled = blocked?.map((b) => ({ ...b, endLabel: formatNiyazEndTime(b.endAt) }));
    return NextResponse.json({ status: "unregistered_recorded", updated: upserted, rsvps, blocked: blockedLabeled });
  }

  const partial = parsed.data.adults !== undefined || parsed.data.kids !== undefined
    ? { adults: parsed.data.adults, kids: parsed.data.kids }
    : undefined;

  const result = await setFamilyNiyazRsvp(
    family.familyId,
    parsed.data.entries.map((e) => ({ attending: e.attending, titles: e.titles, dates: e.dates, meal: e.meal, all: e.all })),
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

  // Return the post-change RSVP as the same per-day, today-onward shape the GET returns, so the
  // agent's read-back is identical whether the family just asked or just made a change.
  const today = todayChicago();
  const days = (await getFamilyNiyazDays(family.familyId))
    .filter((d) => d.date >= today)
    .map((d) => ({ ...d, dateLabel: dateLabel(d.date) }));

  // Days whose RSVP cutoff has passed and so were NOT changed — the agent tells the user.
  const blocked = result.blocked?.map((b) => ({ ...b, endLabel: formatNiyazEndTime(b.endAt) }));

  return NextResponse.json({ status: "ok", updated: result.updated, days, clamped: clampNotice, blocked });
}
