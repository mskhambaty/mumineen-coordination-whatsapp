import { NextRequest, NextResponse } from "next/server";

import {
  resolveCallerFromRequest,
  guardDeptAccess,
  ForbiddenError,
} from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const caller = await resolveCallerFromRequest(req);
    const { id } = await params;
    guardDeptAccess(caller, id);

    const supabase = getSupabaseAdmin();
    const status = req.nextUrl.searchParams.get("status");

    let query = supabase
      .from("tasks")
      .select("id, title, description, status, assigned_to, created_by, source, due_date, department_id, created_at, updated_at, assignee:whatsapp_users!tasks_assigned_to_fkey(display_name)")
      .eq("department_id", id)
      .order("updated_at", { ascending: false });

    if (status && status !== "all") {
      query = query.eq("status", status);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 401 });
  }
}
