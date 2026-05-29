import { getSupabaseAdmin } from "@/lib/supabase/server";

export type CallerContext = {
  user_id: string;
  display_name: string | null;
  global_role: "member" | "pm" | "hod" | "leadership_admin";
  can_read_all: boolean;
  can_write_all: boolean;
  departments: { department_id: string; department_name: string; dept_role: string }[];
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

export async function resolveCallerFromRequest(req: Request): Promise<CallerContext> {
  const phone = req.headers.get("x-whatsapp-from");
  if (phone) {
    return resolveCallerFromPhone(phone);
  }
  if (requireAdminKey(req)) {
    // Admin key gives full access
    return {
      user_id: "admin-api",
      display_name: "Admin API",
      global_role: "leadership_admin",
      can_read_all: true,
      can_write_all: true,
      departments: [],
    };
  }
  throw new Error("Unauthorized: missing x-whatsapp-from header or x-admin-key");
}
