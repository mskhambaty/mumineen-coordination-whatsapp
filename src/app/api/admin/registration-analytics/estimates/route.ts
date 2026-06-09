import { NextRequest, NextResponse } from "next/server";

import { canViewRegistrations } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

type MuminRow = {
  its: string;
  hof_its: string;
  is_head: boolean;
  local_mehman: string | null;
  age: number | null;
  rahat_seating: boolean | null;
  wheelchair: boolean | null;
  not_attending: boolean | null;
};

type FamilyRow = {
  hof_its: string;
  registration_status: string | null;
  transport_mode: string | null;
  acc_type: string | null;
  utaro_host_its: string | null;
};

const PAGE = 1000;
async function fetchAll<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null }>,
): Promise<T[]> {
  const all: T[] = [];
  let start = 0;
  for (;;) {
    const { data } = await buildQuery(start, start + PAGE - 1);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    start += PAGE;
  }
  return all;
}

// Parking passes for a local family: 1 per every 5 people (rounded up).
// e.g. 1-5 → 1, 6-10 → 2, 11-15 → 3. Zero attending = 0 passes.
function localFamilyPasses(attendingCount: number): number {
  return attendingCount > 0 ? Math.ceil(attendingCount / 5) : 0;
}

export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, canViewRegistrations);
  if (auth instanceof NextResponse) return auth;

  const supabase = getSupabaseAdmin();

  const [allMembers, allFams] = await Promise.all([
    fetchAll<MuminRow>((from, to) =>
      supabase
        .from("mumineen")
        .select("its, hof_its, is_head, local_mehman, age, rahat_seating, wheelchair, not_attending")
        .eq("roster_active", true)
        .range(from, to),
    ),
    fetchAll<FamilyRow>((from, to) =>
      supabase
        .from("families")
        .select("hof_its, registration_status, transport_mode, acc_type, utaro_host_its")
        .eq("roster_active", true)
        .range(from, to),
    ),
  ]);

  // Any member ITS → their family's hof_its. Used to resolve cases where
  // a guest entered a non-head family member's ITS as the host.
  const memberToHof = new Map<string, string>();
  for (const m of allMembers) memberToHof.set(m.its, m.hof_its);

  // Determine local_mehman per family (HOF first, fallback to any member)
  const hofType = new Map<string, string>();
  for (const m of allMembers) {
    if (m.is_head && m.local_mehman) hofType.set(m.hof_its, m.local_mehman);
  }
  for (const m of allMembers) {
    if (!hofType.has(m.hof_its) && m.local_mehman) hofType.set(m.hof_its, m.local_mehman);
  }

  // Per-family attending counts and accessibility flags
  type FamStats = {
    attending: number;
    over65: number;       // attending members aged > 65
    rahat: number;        // attending members with rahat_seating = true
    wheelchair: number;   // attending members with wheelchair = true
  };
  const famStats = new Map<string, FamStats>();
  for (const m of allMembers) {
    if (m.not_attending === true) continue;
    const s = famStats.get(m.hof_its) ?? { attending: 0, over65: 0, rahat: 0, wheelchair: 0 };
    s.attending++;
    if ((m.age ?? 0) > 65) s.over65++;
    if (m.rahat_seating === true) s.rahat++;
    if (m.wheelchair === true) s.wheelchair++;
    famStats.set(m.hof_its, s);
  }

  const isRegistered = (status: string | null) => status === "submitted";

  // Pre-compute Mehman rental rate from registered families so the forecast can extrapolate.
  // Unregistered Mehman have null transport_mode, so we can't count them directly.
  const registeredMehmanTotal = allFams.filter(
    (f) => isRegistered(f.registration_status) && hofType.get(f.hof_its) === "Mehman",
  ).length;
  const registeredMehmanRental = allFams.filter(
    (f) => isRegistered(f.registration_status) && hofType.get(f.hof_its) === "Mehman" && f.transport_mode === "rental",
  ).length;
  const mehmanRentalRate = registeredMehmanTotal > 0 ? registeredMehmanRental / registeredMehmanTotal : 0;
  const totalMehmanFamilies = allFams.filter((f) => hofType.get(f.hof_its) === "Mehman").length;

  // Rahat rate from registered families — unregistered haven't filled out rahat_seating yet.
  let regRahatPeople = 0, regAttendingPeople = 0;
  for (const f of allFams) {
    if (!isRegistered(f.registration_status)) continue;
    const s = famStats.get(f.hof_its);
    if (!s) continue;
    regRahatPeople += s.rahat;
    regAttendingPeople += s.attending;
  }
  const rahatRate = regAttendingPeople > 0 ? regRahatPeople / regAttendingPeople : 0;

  function computeEstimates(fams: FamilyRow[], isForecast = false) {
    let localPasses = 0;
    let mehmanRentalPasses = 0;
    let rahatLocalAllOver65 = 0;    // local families where every attending member is > 65
    let rahatMehmanOver65Rental = 0; // Mehman families: rental + at least one > 65
    let localOver65Members = 0;     // individual local attending members aged > 65 (drop-off passes)
    let localOver65Families = 0;   // local families with at least one attending member aged > 65

    let rahatPeople = 0;
    let nonRahatPeople = 0;
    let wheelchairPeople = 0;

    // Map resolved hof_its → Mehman guest families staying with them (within this fams scope).
    // utaro_host_its may contain any family member's ITS — resolve to hof_its via memberToHof.
    // Keys that don't resolve to a known family (orphan hosts) are kept as-is so we can
    // still add a parking pass for their premises in a second pass below.
    const hostGuests = new Map<string, FamilyRow[]>();
    for (const f of fams) {
      if (f.acc_type === "utaro" && f.utaro_host_its) {
        const rawIts = f.utaro_host_its.trim();
        const key = memberToHof.get(rawIts) ?? rawIts;
        if (!hostGuests.has(key)) hostGuests.set(key, []);
        hostGuests.get(key)!.push(f);
      }
    }

    // Set of hof_its values present in this scope — used to detect orphan hosts.
    const famHofItsInScope = new Set(fams.map((f) => f.hof_its));

    for (const f of fams) {
      const type = hofType.get(f.hof_its);
      const s = famStats.get(f.hof_its) ?? { attending: 0, over65: 0, rahat: 0, wheelchair: 0 };

      // Parking
      if (type === "Local") {
        // Effective headcount = own members + non-rental Mehman guests.
        // Guests with rental car already have their own pass and drive themselves.
        let effectiveCount = s.attending;
        for (const guest of hostGuests.get(f.hof_its) ?? []) {
          if (guest.transport_mode !== "rental") {
            effectiveCount += famStats.get(guest.hof_its)?.attending ?? 0;
          }
        }
        localPasses += localFamilyPasses(effectiveCount);
        if (s.attending > 0 && s.attending === s.over65) rahatLocalAllOver65++;
        localOver65Members += s.over65;
        if (s.over65 > 0) localOver65Families++;
      } else if (type === "Mehman") {
        // For forecast: extrapolate rental passes using the registered rental rate.
        // For current: only count families that have actually chosen rental.
        if (isForecast || f.transport_mode === "rental") {
          if (!isForecast) {
            mehmanRentalPasses++;
            if (s.over65 > 0) rahatMehmanOver65Rental++;
          }
        }
      }

      // Thaals (all families)
      rahatPeople += s.rahat;
      nonRahatPeople += s.attending - s.rahat;
      wheelchairPeople += s.wheelchair;
    }

    // Orphan hosts: local families whose ITS isn't in the families table (e.g. not registered
    // themselves) but who are hosting utaro guests. Add a parking pass for their premises.
    for (const [hostKey, guests] of hostGuests) {
      if (famHofItsInScope.has(hostKey)) continue; // already handled in the loop above
      let effectiveCount = 0;
      for (const guest of guests) {
        if (guest.transport_mode !== "rental") {
          effectiveCount += famStats.get(guest.hof_its)?.attending ?? 0;
        }
      }
      localPasses += localFamilyPasses(effectiveCount);
    }

    // For forecast, apply the rental rate to the full Mehman roster
    if (isForecast) {
      mehmanRentalPasses = Math.round(mehmanRentalRate * totalMehmanFamilies);
      // Extrapolate rahat Mehman rental proportionally from current
      const rahatRentalRate = registeredMehmanRental > 0 ? rahatMehmanOver65Rental / registeredMehmanRental : 0;
      // rahatMehmanOver65Rental is still 0 here (not counted in loop for forecast), compute from rate
      const currentRahatMehmanRental = allFams
        .filter((f) => isRegistered(f.registration_status) && hofType.get(f.hof_its) === "Mehman" && f.transport_mode === "rental")
        .filter((f) => (famStats.get(f.hof_its)?.over65 ?? 0) > 0).length;
      rahatMehmanOver65Rental = Math.round(rahatRentalRate > 0
        ? rahatRentalRate * mehmanRentalPasses
        : currentRahatMehmanRental * (totalMehmanFamilies / Math.max(registeredMehmanTotal, 1)));

      // Extrapolate rahat people using the registered rahat rate — unregistered mumineen
      // haven't filled out rahat_seating yet so the loop above undercounts them.
      const totalAttending = rahatPeople + nonRahatPeople;
      rahatPeople = Math.round(rahatRate * totalAttending);
      nonRahatPeople = totalAttending - rahatPeople;
    }

    return {
      parking: {
        local_passes: localPasses,
        mehman_rental_passes: mehmanRentalPasses,
        total: localPasses + mehmanRentalPasses,
        local_over65_members: localOver65Members,
        local_over65_families: localOver65Families,
        rahat_analysis: {
          local_all_over65: rahatLocalAllOver65,
          mehman_over65_rental: rahatMehmanOver65Rental,
        },
      },
      thaals: {
        rahat_people: rahatPeople,
        rahat_thaals: Math.ceil(rahatPeople / 8),
        non_rahat_people: nonRahatPeople,
        non_rahat_thaals: Math.ceil(nonRahatPeople / 8),
        total_people: rahatPeople + nonRahatPeople,
        total_thaals: Math.ceil((rahatPeople + nonRahatPeople) / 8),
        wheelchair_people: wheelchairPeople,
      },
    };
  }

  const registeredFams = allFams.filter((f) => isRegistered(f.registration_status));

  return NextResponse.json({
    current: computeEstimates(registeredFams, false),
    forecast: computeEstimates(allFams, true),
  });
}
