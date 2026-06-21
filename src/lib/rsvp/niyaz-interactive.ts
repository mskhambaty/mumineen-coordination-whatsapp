import { getEventConfigByDayId, type NiyazEventConfig } from "@/lib/rsvp/event-config";
import { formatNiyazEndTime } from "@/lib/rsvp/niyaz-format";
import { getFamilyTemplateFields } from "@/lib/rsvp/niyaz-prompt";
import { getFamilyByHofIts, getNiyazRsvpStatus, recordNiyazDayRsvp } from "@/lib/rsvp/meal-rsvp";
import { resolveApprovedTemplateForAnyAccount, sendTemplateNotification } from "@/lib/whatsapp/send-template";
import { resolveBindings, type Binding, type ButtonBinding, type VariableBindings } from "@/lib/whatsapp/templates";

// Outcome of decoding an interactive response: recorded (RSVP saved + confirmation sent), ended (past
// the day's cutoff — caller should reply with `endedMessage`), or ignored (family/day unresolved).
export type NiyazInteractiveOutcome = { status: "recorded" | "ended" | "ignored"; endedMessage?: string };

// Phase 2: decode a double-RSVP interactive response into niyaz_rsvp records, then send the day's
// confirmation template back to the responder. The payload carries the family (hof_its), the niyaz
// DAY (registration_instance_id = niyaz_event_config.day_id), and the lunch/dinner attending counts.
// Never throws on a resolvable failure, so the raw capture is preserved.
export async function recordNiyazRsvpFromInteractive(opts: {
  hofIts: string;
  dayId: number;
  // Double-meal Flow / quick-reply: explicit per-meal counts.
  lunchCount?: number;
  dinnerCount?: number;
  // Single-meal Flow (ashara_relay_single_rsvp): one count applied to the day's served meal.
  attendingCount?: number;
  phone?: string | null;
}): Promise<NiyazInteractiveOutcome> {
  if (!opts.hofIts || !Number.isFinite(opts.dayId)) return { status: "ignored" };
  const family = await getFamilyByHofIts(opts.hofIts);
  if (!family) return { status: "ignored" };
  const config = await getEventConfigByDayId(opts.dayId);
  if (!config?.eventDate) return { status: "ignored" };

  // RSVP closed: reject late responses with a notice instead of recording.
  if (config.rsvpEndAt) {
    const end = new Date(config.rsvpEndAt);
    if (!Number.isNaN(end.getTime()) && Date.now() > end.getTime()) {
      const title = config.rsvpEventTitle || "this niyaz";
      const when = formatNiyazEndTime(config.rsvpEndAt);
      return {
        status: "ended",
        endedMessage: `Shukran for your reply. RSVP for ${title} has ended${when ? ` (closed ${when})` : ""}, so your response could not be recorded. Please contact the relay center if you need to make a change.`,
      };
    }
  }

  // The single-meal Flow returns one attending_count; apply it to whichever meal(s) the day serves
  // (dinner-only Ashura → dinner). The double path passes explicit lunch/dinner counts.
  const lunchCount = opts.attendingCount != null ? (config.hasLunch ? opts.attendingCount : 0) : opts.lunchCount ?? 0;
  const dinnerCount = opts.attendingCount != null ? (config.hasDinner ? opts.attendingCount : 0) : opts.dinnerCount ?? 0;

  await recordNiyazDayRsvp(family.familyId, family.hofIts, config.eventDate, lunchCount, dinnerCount, opts.phone ?? null);

  // Confirmation back to the responder (best-effort — never blocks the record).
  try {
    await sendNiyazConfirmation({ config, family, lunchCount, dinnerCount, phone: opts.phone ?? null });
  } catch (err) {
    console.error("Niyaz confirmation send failed", { dayId: opts.dayId, err });
  }
  return { status: "recorded" };
}

// The composer stores confirmation buttons in the broadcast API shape (flow_token / flow_action_data);
// map them to the resolver's ButtonBinding shape (flowToken / flowActionData).
type RawButton = { type: string; index: number; flow_token?: string; flow_action_data?: Record<string, string>; payload?: string };
function toButtonBindings(raw: unknown[] | null): ButtonBinding[] {
  return ((raw ?? []) as RawButton[]).map((b) =>
    b.type === "flow"
      ? { type: "flow", index: b.index, flowToken: b.flow_token ?? "", flowActionData: b.flow_action_data ?? {} }
      : { type: "quick_reply", index: b.index, payload: b.payload ?? "" },
  );
}

// Send the day's confirmation template to one responder, resolving its variable/button bindings
// against the family's fields + the just-submitted counts + the recomputed rsvp_status string.
export async function sendNiyazConfirmation(opts: {
  config: NiyazEventConfig;
  family: { familyId: string; hofIts: string };
  lunchCount: number;
  dinnerCount: number;
  phone?: string | null;
}): Promise<void> {
  const { config, family } = opts;
  if (!config.confirmationTemplateCode || !config.eventDate || config.dayId == null || !opts.phone) return;

  const { account, descriptor } = await resolveApprovedTemplateForAnyAccount(config.confirmationTemplateCode);

  const fields = await getFamilyTemplateFields(family.familyId);
  fields.hof_its = family.hofIts;
  fields.lunch_attending_count = String(opts.lunchCount);
  fields.dinner_attending_count = String(opts.dinnerCount);
  fields.rsvp_status = await getNiyazRsvpStatus(family.familyId, config.eventDate);

  // Stored bindings are a flat token→binding map; split into body (descriptor.bodyVars) + header
  // (descriptor.headerVar) for the resolver.
  const flat = (config.confirmationVariableBindings ?? {}) as Record<string, Binding>;
  const body: Record<string, Binding> = {};
  for (const tok of descriptor.bodyVars) if (flat[tok]) body[tok] = flat[tok];
  const bindings: VariableBindings = {
    body,
    header: descriptor.headerVar ? flat[descriptor.headerVar] : undefined,
    buttons: toButtonBindings(config.confirmationButtons),
    buttonTokens: { RegistrationInstanceId: String(config.dayId) },
  };

  const { inputs, skipReason } = resolveBindings(descriptor, bindings, fields);
  if (skipReason) {
    console.error("Niyaz confirmation skipped (unresolved binding)", { dayId: config.dayId, skipReason });
    return;
  }

  await sendTemplateNotification({
    phoneE164: opts.phone,
    templateName: descriptor.name,
    bodyParams: inputs.bodyParams ?? [],
    inputs,
    descriptor,
    account,
    source: "niyaz_rsvp_confirmation",
  });
}

// Parse the integer count fields a WhatsApp Flow returns (they arrive as strings like "2").
export function parseCount(v: unknown): number {
  const n = parseInt(String(v ?? "0"), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// The family + niyaz day encoded in an RSVP flow_token / button payload: `rsvp:<hof_its>:<day_id>`
// (a quick-reply may append a `:<action>`). We send this on every RSVP button/Flow, and the webhook
// stores it verbatim, so it's the reliable source for hof_its + day_id even when a Flow body omits
// registration_instance_id (e.g. the single-meal template's Flow).
export function parseRsvpToken(token: string | null | undefined): { hofIts?: string; dayId?: number } {
  const parts = (token ?? "").split(":");
  if (parts[0] !== "rsvp" || parts.length < 3) return {};
  const dayId = Number(parts[2]);
  return { hofIts: parts[1] || undefined, dayId: Number.isFinite(dayId) ? dayId : undefined };
}
