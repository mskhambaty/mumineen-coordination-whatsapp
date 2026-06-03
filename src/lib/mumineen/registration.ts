import { optionalEnv } from "@/lib/env";
import { getSetting, setSetting } from "@/lib/settings";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const REGISTRATION_GATE_KEY = "registration_gate_enabled";

// The registration gate is OFF until explicitly enabled — turning it on before the roster is
// imported and families have registered would block everyone. The admin UI toggles it live via
// app_settings; if no row exists yet we fall back to the REGISTRATION_GATE_ENABLED env default.
export async function isRegistrationGateEnabled(): Promise<boolean> {
  const stored = await getSetting(REGISTRATION_GATE_KEY);
  if (stored !== null) return stored === "true";
  return optionalEnv("REGISTRATION_GATE_ENABLED") === "true";
}

export async function setRegistrationGateEnabled(enabled: boolean, updatedBy?: string): Promise<void> {
  await setSetting(REGISTRATION_GATE_KEY, enabled ? "true" : "false", updatedBy);
}

export type RegistrationStatus = {
  registered: boolean;
  in_roster: boolean;
  member_count: number;
  hof_its: string | null;
  primary_mumin_its: string | null;
  status: string | null;
};

// Look up whether an inbound phone belongs to a registered family (via mumin_phone_links).
export async function getRegistrationStatus(phone: string): Promise<RegistrationStatus> {
  const { data, error } = await getSupabaseAdmin().rpc("get_registration_status", { p_phone: phone });
  if (error || !data) {
    return { registered: false, in_roster: false, member_count: 0, hof_its: null, primary_mumin_its: null, status: null };
  }
  return data as RegistrationStatus;
}
