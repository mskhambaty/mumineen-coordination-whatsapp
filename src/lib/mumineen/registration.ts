import { optionalEnv } from "@/lib/env";
import { getSupabaseAdmin } from "@/lib/supabase/server";

// The registration gate is OFF until explicitly enabled — turning it on before the roster is
// imported and families have registered would block everyone. Flip REGISTRATION_GATE_ENABLED=true
// once registration data is in place.
export function isRegistrationGateEnabled(): boolean {
  return optionalEnv("REGISTRATION_GATE_ENABLED") === "true";
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
