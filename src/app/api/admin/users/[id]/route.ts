import { NextRequest, NextResponse } from "next/server";

import { requireAdminKey } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("whatsapp_users")
    .select("id, display_name, phone_e164, email, role, global_role, status")
    .eq("id", id)
    .single();

  if (error) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json(data);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();
  const supabase = getSupabaseAdmin();

  const updates: Record<string, unknown> = {};
  if (body.global_role) updates.global_role = body.global_role;
  if (body.status) updates.status = body.status;
  if (body.role) updates.role = body.role;
  if (body.display_name) updates.display_name = body.display_name;
  if (body.email !== undefined) updates.email = body.email;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No updates provided" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("whatsapp_users")
    .update(updates)
    .eq("id", id)
    .select("id, display_name, phone_e164, email, role, global_role, status")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const supabase = getSupabaseAdmin();

  const { data: target, error: lookupError } = await supabase
    .from("whatsapp_users")
    .select("id, role, global_role")
    .eq("id", id)
    .maybeSingle();

  if (lookupError) {
    return NextResponse.json({ error: lookupError.message }, { status: 500 });
  }

  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const isPortalAdmin = target.role === "admin" || target.global_role === "leadership_admin";
  if (isPortalAdmin) {
    const { count, error: countError } = await supabase
      .from("whatsapp_users")
      .select("id", { count: "exact", head: true })
      .neq("id", id)
      .or("role.eq.admin,global_role.eq.leadership_admin");

    if (countError) {
      return NextResponse.json({ error: countError.message }, { status: 500 });
    }

    if ((count ?? 0) === 0) {
      return NextResponse.json(
        { error: "Cannot delete the last admin or leadership user" },
        { status: 400 },
      );
    }
  }

  const { data, error } = await supabase
    .from("whatsapp_users")
    .delete()
    .eq("id", id)
    .select("id, display_name, phone_e164, email")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({ deleted: true, user: data });
}
