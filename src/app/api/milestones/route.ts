import { NextRequest, NextResponse } from "next/server";

import { ForbiddenError, resolveCallerFromRequest } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  try {
    const caller = await resolveCallerFromRequest(req);
    const supabase = getSupabaseAdmin();

    const departmentId = req.nextUrl.searchParams.get("department_id");
    const status = req.nextUrl.searchParams.get("status");

    let query = supabase
      .from("milestones")
      .select("id, title, description, budget, percent_complete, status, notes, department_id, created_at, updated_at, departments(name)")
      .order("created_at", { ascending: false });

    if (departmentId) {
      query = query.eq("department_id", departmentId);
    } else if (!caller.can_read_all) {
      const deptIds = caller.departments.map((d) => d.department_id);
      if (deptIds.length === 0) {
        return NextResponse.json([]);
      }
      query = query.in("department_id", deptIds);
    }

    if (status && status !== "all") {
      query = query.eq("status", status);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data ?? []);
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 401 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const caller = await resolveCallerFromRequest(req);
    const body = (await req.json()) as {
      title?: unknown;
      description?: unknown;
      budget?: unknown;
      department_id?: unknown;
      notes?: unknown;
      status?: unknown;
      percent_complete?: unknown;
    };

    const title = typeof body.title === "string" ? body.title.trim() : "";
    const departmentId = typeof body.department_id === "string" ? body.department_id : "";

    if (!title || !departmentId) {
      return NextResponse.json({ error: "title and department_id are required" }, { status: 400 });
    }

    if (!caller.can_write_all) {
      const hasDept = caller.departments.find((d) => d.department_id === departmentId);
      if (!hasDept || hasDept.dept_role === "member") {
        return NextResponse.json({ error: "No write access to this department" }, { status: 403 });
      }
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("milestones")
      .insert({
        title,
        department_id: departmentId,
        description: typeof body.description === "string" ? body.description : null,
        budget: typeof body.budget === "number" ? body.budget : null,
        notes: typeof body.notes === "string" ? body.notes : null,
        status: typeof body.status === "string" && ["open", "in_progress", "blocked", "complete"].includes(body.status) ? body.status : "open",
        percent_complete: typeof body.percent_complete === "number" ? Math.max(0, Math.min(100, body.percent_complete)) : 0,
        created_by: caller.user_id !== "admin-api" ? caller.user_id : null,
      })
      .select("id, title, description, budget, percent_complete, status, notes, department_id, created_at, updated_at")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 401 });
  }
}
