import { isAdminOrLeadership } from "@/lib/admin/access";
import {
  isDepartmentManager,
  isDepartmentMember,
  isEscalationSupportMember,
  isItMember,
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
  is_internal: boolean;
};

export async function buildPortalSessionUser(user: PortalSessionSourceUser): Promise<PortalSessionUser> {
  const isSupport = await isEscalationSupportMember(user.id);
  const isManager =
    user.global_role === "pm" || user.global_role === "hod" || (await isDepartmentManager(user.id));
  const isIt = await isItMember(user.id);
  const isTransport = await isTransportMember(user.id);
  // Internal = assigned to any department (managers/IT are internal by definition).
  const isInternal = isManager || isIt || isTransport || (await isDepartmentMember(user.id));

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
    is_internal: isInternal,
  };
}

export async function canAccessPortal(user: PortalSessionSourceUser): Promise<boolean> {
  const sessionUser = await buildPortalSessionUser(user);
  return (
    isAdminOrLeadership(user) ||
    sessionUser.is_support ||
    sessionUser.is_manager ||
    sessionUser.is_it ||
    sessionUser.is_internal
  );
}

