import { NextRequest, NextResponse } from "next/server";

import { resolveCallerFromRequest, ForbiddenError } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  try {
    const caller = await resolveCallerFromRequest(req);
    const supabase = getSupabaseAdmin();

    let query = supabase.from("departments").select("id, name, description, created_at").order("name");

    // If not leadership_admin, only return their departments
    if (!caller.can_read_all) {
      const deptIds = caller.departments.map((d) => d.department_id);
      if (deptIds.length === 0) {
        return NextResponse.json([]);
      }
      query = query.in("id", deptIds);
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

export async function POST(req: NextRequest) {
  try {
    const caller = await resolveCallerFromRequest(req);
    if (!caller.can_write_all) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as { name?: unknown; description?: unknown };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() || null : null;

    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("departments")
      .insert({ name, description })
      .select("id, name, description, created_at")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: error.code === "23505" ? 409 : 500 });
    }

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 401 });
  }
}
