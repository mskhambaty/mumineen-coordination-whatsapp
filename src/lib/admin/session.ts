import {
  isAccommodationsMember,
  isDepartmentManager,
  isDepartmentMember,
  isEscalationSupportMember,
  isItMember,
  isReligiousMonitor,
  isTransportMember,
} from "@/lib/supabase/server";

export type PortalSessionSourceUser = {
  id: string;
  display_name: string | null;
  email: string | null;
  role: string | null;
  global_role: string | null;
};

export type PortalSessionUser = {
  id: string;
  display_name: string | null;
  email: string | null;
  role: string | null;
  global_role: string | null;
  is_support: boolean;
  is_manager: boolean;
  is_it: boolean;
  is_transport: boolean;
  is_accommodations: boolean;
  is_internal: boolean;
  is_religious_monitor: boolean;
};

export async function buildPortalSessionUser(user: PortalSessionSourceUser): Promise<PortalSessionUser> {
  const isSupport = await isEscalationSupportMember(user.id);
  const isManager =
    user.global_role === "pm" || user.global_role === "hod" || (await isDepartmentManager(user.id));
  const isIt = await isItMember(user.id);
  const isTransport = await isTransportMember(user.id);
  const isAccommodations = await isAccommodationsMember(user.id);
  // Internal = assigned to any department (managers/IT are internal by definition).
  const isInternal = isManager || isIt || isTransport || isAccommodations || (await isDepartmentMember(user.id));
  // On the Waaz Talaqqi monitor team — needed so the /admin/religious gate + nav see the flag
  // (the page reads this from the stored login user, not the per-request permissions RPC).
  const isReligious = await isReligiousMonitor(user.id);

  return {
    id: user.id,
    display_name: user.display_name,
    email: user.email,
    role: user.role,
    global_role: user.global_role,
    is_support: isSupport,
    is_manager: isManager,
    is_it: isIt,
    is_transport: isTransport,
    is_accommodations: isAccommodations,
    is_internal: isInternal,
    is_religious_monitor: isReligious,
  };
}

