import { beforeEach, describe, expect, it, vi } from "vitest";

// Unit test for resolveNiyazCsvRecipients: an uploaded audience-export CSV is parsed, each row is
// matched back to the roster by its WhatsApp number, and recipients carry the same computed fields a
// resolved audience would (family_id, mumin_id, eligible_family_count) so the RSVP buttons personalize.

const getSupabaseAdmin = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => getSupabaseAdmin() }));

import { resolveNiyazCsvRecipients } from "@/lib/rsvp/niyaz-prompt";

type Row = Record<string, unknown>;

// Chainable, range-paged fake of the Supabase builder. Routes by the .in() column: a whatsapp_e164
// lookup returns roster members by phone; a family_id lookup returns each family's members.
function makeSupabase(opts: { memberByPhone: Record<string, Row>; familyMembers: Record<string, Row[]> }) {
  function builder() {
    const state: { inField: string; inValues: string[] } = { inField: "", inValues: [] };
    const b = {
      from: () => b,
      select: () => b,
      eq: () => b,
      not: () => b,
      order: () => b,
      in: (field: string, values: string[]) => {
        state.inField = field;
        state.inValues = values;
        return b;
      },
      range: (from: number, to: number) => {
        let rows: Row[] = [];
        if (state.inField === "whatsapp_e164") {
          const seen = new Set<string>();
          for (const v of state.inValues) {
            const key = v.startsWith("+") ? v : `+${v}`;
            const m = opts.memberByPhone[key];
            if (m && !seen.has(m.id as string)) {
              seen.add(m.id as string);
              rows.push(m);
            }
          }
        } else if (state.inField === "family_id") {
          rows = state.inValues.flatMap((fid) => opts.familyMembers[fid] ?? []);
        }
        return Promise.resolve({ data: rows.slice(from, to + 1) });
      },
    };
    return b;
  }
  return { from: () => builder() };
}

beforeEach(() => vi.clearAllMocks());

describe("resolveNiyazCsvRecipients", () => {
  it("matches CSV rows to the roster and attaches family fields; unmatched rows still send", async () => {
    getSupabaseAdmin.mockReturnValue(
      makeSupabase({
        memberByPhone: {
          "+15551112222": { id: "m1", family_id: "f1", whatsapp_e164: "+15551112222", is_adult: true, full_name: "Ali Roster", its: "10000001", hof_its: "10000001" },
        },
        familyMembers: {
          // f1: two eligible adults + one young child (age 3, excluded) → eligible_family_count 2.
          f1: [
            { family_id: "f1", full_name: "Ali", not_attending: false, age: 40 },
            { family_id: "f1", full_name: "Fatema", not_attending: false, age: 38 },
            { family_id: "f1", full_name: "Kid", not_attending: false, age: 3 },
          ],
        },
      }),
    );

    const csv = ["Name,ITS,HOF ITS,WhatsApp", "Ali,10000001,10000001,+15551112222", "Guest,,,+15559998888"].join("\n");
    const { recipients, parsed, error } = await resolveNiyazCsvRecipients(csv);

    expect(error).toBeUndefined();
    expect(parsed).toBe(2);
    expect(recipients).toHaveLength(2);

    const matched = recipients.find((r) => r.phone === "+15551112222")!;
    expect(matched.familyId).toBe("f1");
    expect(matched.muminId).toBe("m1");
    expect(matched.fields?.hof_its).toBe("10000001");
    expect(matched.fields?.eligible_family_count).toBe("2"); // child excluded
    expect(matched.fields?.mumin_id).toBe("m1");

    // No roster match → kept (so the admin's list still gets messaged), eligible_family_count defaults to 1.
    const guest = recipients.find((r) => r.phone === "+15559998888")!;
    expect(guest.familyId).toBeNull();
    expect(guest.fields?.eligible_family_count).toBe("1");
  });

  it("returns the parse error (and no recipients) when the CSV has no WhatsApp column", async () => {
    getSupabaseAdmin.mockReturnValue(makeSupabase({ memberByPhone: {}, familyMembers: {} }));
    const { recipients, error } = await resolveNiyazCsvRecipients("Name,ITS\nAli,10000001\n");
    expect(error).toBeTruthy();
    expect(recipients).toHaveLength(0);
  });
});
