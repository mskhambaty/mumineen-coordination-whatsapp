import { PortalUser } from "@/lib/admin/access";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/admin/session-token";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export type CallerContext = {
  user_id: string;
  display_name: string | null;
  role?: "visitor" | "committee" | "admin";
  global_role: "member" | "pm" | "hod" | "leadership_admin";
  can_read_all: boolean;
  can_write_all: boolean;
  departments: { department_id: string; department_name: string; dept_role: string }[];
  // Portal page-gate flags (sessions and admin-key callers only; absent on WhatsApp callers).
  portal?: PortalUser;
};

export async function resolveCallerFromPhone(phone: string): Promise<CallerContext> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase.rpc("get_user_permissions", { p_phone: phone });

  if (error) {
    throw new Error(`Failed to resolve caller permissions: ${error.message}`);
  }

  const result = data as Record<string, unknown>;

  if (!result || result.global_role === "unknown") {
    throw new Error("User not found");
  }

  return {
    user_id: result.user_id as string,
    display_name: (result.display_name as string) ?? null,
    role: result.role as CallerContext["role"],
    global_role: result.global_role as CallerContext["global_role"],
    can_read_all: result.can_read_all as boolean,
    can_write_all: result.can_write_all as boolean,
    departments: (result.departments as CallerContext["departments"]) ?? [],
  };
}

export function requireAdminKey(req: Request): boolean {
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey) return false;
  const providedKey = req.headers.get("x-admin-key");
  return providedKey === adminKey;
}

// Stronger gate for high-stakes admin tools (e.g. paid public broadcasts): requires the portal
// admin key AND that the acting portal user (sent as x-portal-user-id) resolves to admin/leadership
// in the database. Role is read from the DB by id, not trusted from the client. Returns true only
// when both hold.
export async function requireAdminLeadership(req: Request): Promise<boolean> {
  if (!requireAdminKey(req)) return false;
  const userId = req.headers.get("x-portal-user-id");
  if (!userId) return false;
  const { data } = await getSupabaseAdmin()
    .from("whatsapp_users")
    .select("role, global_role, is_master_admin, status")
    .eq("id", userId)
    .maybeSingle();
  if (!data || data.status !== "active") return false;
  return data.role === "admin" || data.global_role === "leadership_admin" || data.is_master_admin === true;
}

export function guardDeptAccess(caller: CallerContext, departmentId: string): void {
  if (caller.can_read_all) return;
  const hasDeptAccess = caller.departments.some((d) => d.department_id === departmentId);
  if (!hasDeptAccess) {
    throw new ForbiddenError("You do not have access to this department");
  }
}

export function guardWriteAccess(caller: CallerContext, departmentId: string): void {
  if (caller.can_write_all) return;
  const dept = caller.departments.find((d) => d.department_id === departmentId);
  if (!dept || dept.dept_role === "member") {
    throw new ForbiddenError("You do not have write access to this department");
  }
}

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnauthorizedError";
  }
}

type PortalPermissions = {
  role: string | null;
  global_role: string | null;
  departments: { department_id: string; department_name: string; dept_role: string }[];
  is_escalation_support: boolean;
};

// Mirrors buildPortalSessionUser / the isItMember-style helpers in supabase/server.ts,
// derived from a single get_user_permissions_by_id round trip.
export function derivePortalFlags(perms: PortalPermissions): PortalUser {
  const deptNames = perms.departments.map((d) => d.department_name);
  const isManager =
    perms.global_role === "pm" ||
    perms.global_role === "hod" ||
    perms.departments.some((d) => d.dept_role === "pm" || d.dept_role === "hod");
  const isIt = deptNames.includes("IT");
  const isTransport = deptNames.includes("Transport");
  return {
    role: perms.role,
    global_role: perms.global_role,
    is_support: perms.is_escalation_support,
    is_manager: isManager,
    is_it: isIt,
    is_transport: isTransport,
    is_internal: isManager || isIt || isTransport || perms.departments.length > 0,
  };
}

export function readSessionCookie(req: Request): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === SESSION_COOKIE_NAME) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

export async function resolveCallerFromSession(req: Request): Promise<CallerContext> {
  const token = readSessionCookie(req);
  const session = token ? verifySessionToken(token) : null;
  if (!session) {
    throw new UnauthorizedError("Missing or invalid portal session");
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("get_user_permissions_by_id", { p_user_id: session.user_id });
  if (error) {
    throw new Error(`Failed to resolve session permissions: ${error.message}`);
  }

  const result = data as Record<string, unknown>;
  if (!result || result.global_role === "unknown") {
    throw new UnauthorizedError("Portal session user not found or inactive");
  }

  const departments = (result.departments as CallerContext["departments"]) ?? [];
  return {
    user_id: result.user_id as string,
    display_name: (result.display_name as string) ?? null,
    role: result.role as CallerContext["role"],
    global_role: result.global_role as CallerContext["global_role"],
    can_read_all: result.can_read_all as boolean,
    can_write_all: result.can_write_all as boolean,
    departments,
    portal: derivePortalFlags({
      role: (result.role as string) ?? null,
      global_role: (result.global_role as string) ?? null,
      departments,
      is_escalation_support: result.is_escalation_support === true,
    }),
  };
}

// Full-access caller for server-to-server x-admin-key requests (agent, cron).
// portal is a blanket allow so every page-gate predicate passes — the flags do
// NOT mean real department membership.
export const ADMIN_API_CALLER: CallerContext = {
  user_id: "admin-api",
  display_name: "Admin API",
  role: "admin",
  global_role: "leadership_admin",
  can_read_all: true,
  can_write_all: true,
  departments: [],
  portal: {
    role: "admin",
    global_role: "leadership_admin",
    is_support: true,
    is_manager: true,
    is_it: true,
    is_transport: true,
    is_internal: true,
  },
};

export async function resolveCallerFromRequest(req: Request): Promise<CallerContext> {
  const phone = req.headers.get("x-whatsapp-from");
  if (phone) {
    return resolveCallerFromPhone(phone);
  }
  if (readSessionCookie(req)) {
    return resolveCallerFromSession(req);
  }
  if (requireAdminKey(req)) {
    // Admin key gives full access (server-to-server only)
    return ADMIN_API_CALLER;
  }
  throw new UnauthorizedError("Unauthorized: missing x-whatsapp-from header, portal session, or x-admin-key");
}
