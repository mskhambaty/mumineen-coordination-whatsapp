import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { ForbiddenError, guardDeptAccess, resolveCallerFromRequest } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

const paramsSchema = z.object({ id: z.string().uuid() });

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const caller = await resolveCallerFromRequest(req);
    const parsed = paramsSchema.safeParse(await params);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid department ID" }, { status: 400 });
    }

    guardDeptAccess(caller, parsed.data.id);

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("department_members")
      .select("dept_role, user:whatsapp_users!department_members_user_id_fkey(id, display_name)")
      .eq("department_id", parsed.data.id)
      .eq("is_active", true);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const members = (data ?? []).flatMap((membership) => {
      const user = Array.isArray(membership.user) ? membership.user[0] : membership.user;
      if (!user?.id) return [];
      return [{
        id: user.id as string,
        display_name: (user.display_name as string | null) ?? null,
        department_role: membership.dept_role as string,
      }];
    });

    return NextResponse.json(members);
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 401 });
  }
}
