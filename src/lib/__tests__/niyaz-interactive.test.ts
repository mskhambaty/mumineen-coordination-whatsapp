import { beforeEach, describe, expect, it, vi } from "vitest";

const getFamilyByHofIts = vi.fn();
const recordNiyazDayRsvp = vi.fn(async () => undefined);
const getNiyazRsvpStatus = vi.fn(async () => "Lunch 2, Dinner 3");
const getEventConfigByDayId = vi.fn();
const getFamilyTemplateFields = vi.fn(async () => ({ full_name: "Aliasger", mumin_name: "Aliasger", family_members: "A, B", eligible_family_count: "4" }));
const resolveApprovedTemplateForAnyAccount = vi.fn();
const sendTemplateNotification = vi.fn(async () => ({ status: "sent" }));
const resolveBindings = vi.fn(() => ({ inputs: { bodyParams: ["Aliasger", "Lunch 2, Dinner 3"] } }));

vi.mock("@/lib/rsvp/meal-rsvp", () => ({
  getFamilyByHofIts: (...a: unknown[]) => getFamilyByHofIts(...a),
  recordNiyazDayRsvp: (...a: unknown[]) => recordNiyazDayRsvp(...a),
  getNiyazRsvpStatus: (...a: unknown[]) => getNiyazRsvpStatus(...a),
}));
vi.mock("@/lib/rsvp/event-config", () => ({ getEventConfigByDayId: (...a: unknown[]) => getEventConfigByDayId(...a) }));
vi.mock("@/lib/rsvp/niyaz-prompt", () => ({ getFamilyTemplateFields: (...a: unknown[]) => getFamilyTemplateFields(...a) }));
vi.mock("@/lib/whatsapp/send-template", () => ({
  resolveApprovedTemplateForAnyAccount: (...a: unknown[]) => resolveApprovedTemplateForAnyAccount(...a),
  sendTemplateNotification: (...a: unknown[]) => sendTemplateNotification(...a),
}));
vi.mock("@/lib/whatsapp/templates", () => ({ resolveBindings: (...a: unknown[]) => resolveBindings(...a) }));

import { parseCount, parseRsvpToken, recordNiyazRsvpFromInteractive } from "@/lib/rsvp/niyaz-interactive";

const DESC = { name: "ashara_relay_double_rsvp_confirmation", language: "en_US", bodyVars: ["mumin_name", "rsvp_status"], headerVar: null };

beforeEach(() => {
  vi.clearAllMocks();
  getFamilyByHofIts.mockResolvedValue({ familyId: "fam-1", hofIts: "40495151" });
  getEventConfigByDayId.mockResolvedValue({ eventDate: "2026-06-16", dayId: 2 }); // no confirmation by default
  resolveApprovedTemplateForAnyAccount.mockResolvedValue({ account: { label: "broadcast", phoneNumberId: "PN_B" }, descriptor: DESC });
});

describe("parseCount", () => {
  it("parses string/number counts; non-positive/invalid → 0", () => {
    expect(parseCount("2")).toBe(2);
    expect(parseCount(3)).toBe(3);
    expect(parseCount("0")).toBe(0);
    expect(parseCount(undefined)).toBe(0);
    expect(parseCount("abc")).toBe(0);
  });
});

describe("parseRsvpToken", () => {
  it("extracts hof_its + day_id from an rsvp flow_token / payload", () => {
    expect(parseRsvpToken("rsvp:30460032:10")).toEqual({ hofIts: "30460032", dayId: 10 });
    expect(parseRsvpToken("rsvp:30460032:10:not-attending")).toEqual({ hofIts: "30460032", dayId: 10 });
    expect(parseRsvpToken("niyaz|fam|both|2026-06-24")).toEqual({});
    expect(parseRsvpToken(null)).toEqual({});
  });
});

describe("recordNiyazRsvpFromInteractive", () => {
  it("resolves family + day and records the per-meal counts", async () => {
    const outcome = await recordNiyazRsvpFromInteractive({ hofIts: "40495151", dayId: 2, lunchCount: 2, dinnerCount: 3, phone: "+1555" });
    expect(outcome.status).toBe("recorded");
    expect(recordNiyazDayRsvp).toHaveBeenCalledWith("fam-1", "40495151", "2026-06-16", 2, 3, "+1555");
  });

  it("maps a single-meal attending_count onto the day's served meal (dinner-only → dinner)", async () => {
    getEventConfigByDayId.mockResolvedValue({ eventDate: "2026-06-24", dayId: 10, hasLunch: false, hasDinner: true });
    const outcome = await recordNiyazRsvpFromInteractive({ hofIts: "40495151", dayId: 10, attendingCount: 4, phone: "+1555" });
    expect(outcome.status).toBe("recorded");
    expect(recordNiyazDayRsvp).toHaveBeenCalledWith("fam-1", "40495151", "2026-06-24", 0, 4, "+1555");
  });

  it("maps a single-meal attending_count onto a lunch-only day (→ lunch)", async () => {
    getEventConfigByDayId.mockResolvedValue({ eventDate: "2026-06-20", dayId: 6, hasLunch: true, hasDinner: false });
    await recordNiyazRsvpFromInteractive({ hofIts: "40495151", dayId: 6, attendingCount: 5, phone: "+1555" });
    expect(recordNiyazDayRsvp).toHaveBeenCalledWith("fam-1", "40495151", "2026-06-20", 5, 0, "+1555");
  });

  it("rejects a response after the RSVP cutoff (ended) without recording", async () => {
    getEventConfigByDayId.mockResolvedValue({ eventDate: "2026-06-16", dayId: 2, rsvpEventTitle: "2nd Moharram", rsvpEndAt: "2020-01-01T00:00:00.000Z" });
    const outcome = await recordNiyazRsvpFromInteractive({ hofIts: "40495151", dayId: 2, lunchCount: 2, dinnerCount: 3, phone: "+1555" });
    expect(outcome.status).toBe("ended");
    expect(outcome.endedMessage).toContain("has ended");
    expect(recordNiyazDayRsvp).not.toHaveBeenCalled();
    expect(sendTemplateNotification).not.toHaveBeenCalled();
  });

  it("records when the cutoff is in the future", async () => {
    getEventConfigByDayId.mockResolvedValue({ eventDate: "2026-06-16", dayId: 2, rsvpEndAt: "2999-01-01T00:00:00.000Z" });
    const outcome = await recordNiyazRsvpFromInteractive({ hofIts: "40495151", dayId: 2, lunchCount: 1, dinnerCount: 1, phone: "+1555" });
    expect(outcome.status).toBe("recorded");
    expect(recordNiyazDayRsvp).toHaveBeenCalled();
  });

  it("does NOT send a confirmation when the day has no confirmation template", async () => {
    await recordNiyazRsvpFromInteractive({ hofIts: "40495151", dayId: 2, lunchCount: 2, dinnerCount: 3, phone: "+1555" });
    expect(sendTemplateNotification).not.toHaveBeenCalled();
  });

  it("sends the confirmation template (with mumin_name + rsvp_status fields) when configured", async () => {
    getEventConfigByDayId.mockResolvedValue({
      eventDate: "2026-06-16",
      dayId: 2,
      confirmationTemplateCode: "ashara_relay_double_rsvp_confirmation",
      confirmationVariableBindings: { mumin_name: { kind: "field", field: "full_name" }, rsvp_status: { kind: "field", field: "rsvp_status" } },
      confirmationButtons: [{ type: "flow", index: 0, flow_token: "rsvp:{{hof_its}}:{{RegistrationInstanceId}}", flow_action_data: {} }],
    });
    await recordNiyazRsvpFromInteractive({ hofIts: "40495151", dayId: 2, lunchCount: 2, dinnerCount: 3, phone: "+15551234567" });

    // rsvp_status recomputed + fields built for the family.
    expect(getNiyazRsvpStatus).toHaveBeenCalledWith("fam-1", "2026-06-16");
    expect(getFamilyTemplateFields).toHaveBeenCalledWith("fam-1");
    // Resolver received the submitted counts + recomputed status in the field map.
    const fields = resolveBindings.mock.calls[0][2] as Record<string, string>;
    expect(fields).toMatchObject({ hof_its: "40495151", lunch_attending_count: "2", dinner_attending_count: "3", rsvp_status: "Lunch 2, Dinner 3" });
    // Sent via the resolved (broadcast) account, tagged as a confirmation.
    expect(sendTemplateNotification).toHaveBeenCalledWith(
      expect.objectContaining({ phoneE164: "+15551234567", templateName: "ashara_relay_double_rsvp_confirmation", source: "niyaz_rsvp_confirmation", account: { label: "broadcast", phoneNumberId: "PN_B" } }),
    );
  });

  it("confirmation send failure does not block the record (still recorded)", async () => {
    getEventConfigByDayId.mockResolvedValue({ eventDate: "2026-06-16", dayId: 2, confirmationTemplateCode: "x" });
    resolveApprovedTemplateForAnyAccount.mockRejectedValue(new Error("template missing"));
    const outcome = await recordNiyazRsvpFromInteractive({ hofIts: "40495151", dayId: 2, lunchCount: 1, dinnerCount: 0, phone: "+1555" });
    expect(outcome.status).toBe("recorded");
    expect(recordNiyazDayRsvp).toHaveBeenCalled();
  });

  it("is a no-op (ignored) when the family or day can't be resolved", async () => {
    getFamilyByHofIts.mockResolvedValue(null);
    expect((await recordNiyazRsvpFromInteractive({ hofIts: "999", dayId: 2, lunchCount: 1, dinnerCount: 1 })).status).toBe("ignored");
    expect(recordNiyazDayRsvp).not.toHaveBeenCalled();
  });
});
