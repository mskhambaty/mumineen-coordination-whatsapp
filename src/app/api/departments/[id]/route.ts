import { NextRequest, NextResponse } from "next/server";

import { ForbiddenError, resolveCallerFromRequest } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const caller = await resolveCallerFromRequest(req);
    if (!caller.can_write_all) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { id } = await params;
    const body = (await req.json()) as { description?: unknown };
    const description = typeof body.description === "string" ? body.description.trim() || null : undefined;

    if (description === undefined) {
      return NextResponse.json({ error: "No updatable fields provided" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("departments")
      .update({ description })
      .eq("id", id)
      .select("id, name, description")
      .single();

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

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const caller = await resolveCallerFromRequest(req);
    if (!caller.can_write_all) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { id } = await params;
    const supabase = getSupabaseAdmin();
    const checks = await Promise.all([
      supabase.from("department_members").select("id", { count: "exact", head: true }).eq("department_id", id),
      supabase.from("tasks").select("id", { count: "exact", head: true }).eq("department_id", id),
      supabase.from("milestones").select("id", { count: "exact", head: true }).eq("department_id", id),
    ]);

    const blockingCount = checks.reduce((sum, result) => sum + (result.count ?? 0), 0);
    const firstError = checks.find((result) => result.error)?.error;
    if (firstError) {
      return NextResponse.json({ error: firstError.message }, { status: 500 });
    }
    if (blockingCount > 0) {
      return NextResponse.json(
        { error: "Department has members, tasks, or milestones and cannot be removed yet" },
        { status: 409 },
      );
    }

    const { error } = await supabase.from("departments").delete().eq("id", id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ deleted: true });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 401 });
  }
}
