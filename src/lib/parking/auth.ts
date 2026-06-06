import { getSupabaseAdmin, isDepartmentManager, isItMember, isTransportMember } from "@/lib/supabase/server";

export type ParkingCaller = {
  userId: string | null;
  canView: boolean;
  canManage: boolean;
};

// Resolves the portal user claimed via the x-admin-user-id header into parking access tiers.
// The shared x-admin-key still gates the route itself; this adds the per-user tier on top:
//   manage = admin/leadership, IT member, or Transport member (assign/revoke/edit lots)
//   view   = manage, plus PM/HOD of any department (read-only)
export async function resolveParkingCaller(req: Request): Promise<ParkingCaller> {
  const userId = req.headers.get("x-admin-user-id");
  if (!userId) return { userId: null, canView: false, canManage: false };

  const { data: user } = await getSupabaseAdmin()
    .from("whatsapp_users")
    .select("id, role, global_role")
    .eq("id", userId)
    .maybeSingle();
  if (!user) return { userId, canView: false, canManage: false };

  const isAdmin = user.role === "admin" || user.global_role === "leadership_admin";
  const canManage = isAdmin || (await isItMember(userId)) || (await isTransportMember(userId));
  // Mirror buildPortalSessionUser's manager rule: global_role pm/hod counts even
  // without a department_members row, so the client and server gates agree.
  const isGlobalManager = user.global_role === "pm" || user.global_role === "hod";
  const canView = canManage || isGlobalManager || (await isDepartmentManager(userId));
  return { userId, canView, canManage };
}
