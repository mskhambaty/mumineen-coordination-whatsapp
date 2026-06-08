import { NextRequest, NextResponse } from "next/server";

import { canViewRegistrations } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

type MuminRow = {
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

// Parking passes for a local family: 1 base + 1 for every additional 5 people
// e.g. 1-5 → 1, 6-10 → 2, 11-15 → 3
function localFamilyPasses(attendingCount: number): number {
  return Math.ceil(Math.max(attendingCount, 1) / 5);
}

export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, canViewRegistrations);
  if (auth instanceof NextResponse) return auth;

  const supabase = getSupabaseAdmin();

  const [allMembers, allFams] = await Promise.all([
    fetchAll<MuminRow>((from, to) =>
      supabase
        .from("mumineen")
        .select("hof_its, is_head, local_mehman, age, rahat_seating, wheelchair, not_attending")
        .eq("roster_active", true)
        .range(from, to),
    ),
    fetchAll<FamilyRow>((from, to) =>
      supabase
        .from("families")
        .select("hof_its, registration_status, transport_mode")
        .eq("roster_active", true)
        .range(from, to),
    ),
  ]);

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

  const isRegistered = (status: string | null) =>
    status === "submitted" || status === "confirmed";

  function computeEstimates(fams: FamilyRow[]) {
    let localPasses = 0;
    let mehmanRentalPasses = 0;
    let rahatLocalAllOver65 = 0;    // local families where every attending member is > 65
    let rahatMehmanOver65Rental = 0; // Mehman families: rental + at least one > 65

    let rahatPeople = 0;
    let nonRahatPeople = 0;
    let wheelchairPeople = 0;

    for (const f of fams) {
      const type = hofType.get(f.hof_its);
      const s = famStats.get(f.hof_its) ?? { attending: 0, over65: 0, rahat: 0, wheelchair: 0 };

      // Parking
      if (type === "Local") {
        localPasses += localFamilyPasses(s.attending);
        if (s.attending > 0 && s.attending === s.over65) rahatLocalAllOver65++;
      } else if (type === "Mehman" && f.transport_mode === "rental") {
        mehmanRentalPasses++;
        if (s.over65 > 0) rahatMehmanOver65Rental++;
      }

      // Thaals (all families, not just local/Mehman with rental)
      rahatPeople += s.rahat;
      nonRahatPeople += s.attending - s.rahat;
      wheelchairPeople += s.wheelchair;
    }

    return {
      parking: {
        local_passes: localPasses,
        mehman_rental_passes: mehmanRentalPasses,
        total: localPasses + mehmanRentalPasses,
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
    current: computeEstimates(registeredFams),
    forecast: computeEstimates(allFams),
  });
}
