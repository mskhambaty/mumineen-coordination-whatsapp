import { NextRequest, NextResponse } from "next/server";

import { canAccessPortal, isAdminOrLeadership } from "@/lib/admin/access";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { requirePortalCaller } from "@/lib/api/portal-auth";

const userRoles = new Set(["visitor", "committee", "admin"]);
const globalRoles = new Set(["member", "pm", "hod", "leadership_admin"]);

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePortalCaller(req, canAccessPortal);
  if (auth instanceof NextResponse) return auth;

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
  const auth = await requirePortalCaller(req, canAccessPortal);
  if (auth instanceof NextResponse) return auth;
  const callerIsAdmin = isAdminOrLeadership(auth.caller.portal);

  const { id } = await params;
  const body = await req.json();
  const supabase = getSupabaseAdmin();

  const updates: Record<string, unknown> = {};
  if (body.global_role) {
    if (!globalRoles.has(body.global_role)) {
      return NextResponse.json({ error: "Invalid global_role" }, { status: 400 });
    }
    updates.global_role = body.global_role;
  }
  if (body.status) {
    if (body.status !== "active" && body.status !== "inactive") {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    updates.status = body.status;
  }
  if (body.role) {
    if (!userRoles.has(body.role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }
    updates.role = body.role;
    if (body.global_role === undefined) {
      updates.global_role = body.role === "admin" ? "leadership_admin" : "member";
    }
  }
  if (body.display_name !== undefined) updates.display_name = body.display_name;
  if (body.phone_e164 !== undefined) updates.phone_e164 = body.phone_e164;
  if (body.email !== undefined) updates.email = body.email;
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No updates provided" }, { status: 400 });
  }

  const { data: existingUser, error: existingUserError } = await supabase
    .from("whatsapp_users")
    .select("id, role, global_role")
    .eq("id", id)
    .maybeSingle();

  if (existingUserError) {
    return NextResponse.json({ error: existingUserError.message }, { status: 500 });
  }

  if (!existingUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const wasPortalAdmin = existingUser.role === "admin" || existingUser.global_role === "leadership_admin";
  const willBePortalAdmin =
    (updates.role ?? existingUser.role) === "admin" ||
    (updates.global_role ?? existingUser.global_role) === "leadership_admin";

  // Only admins/leadership may grant or alter Admin/Leadership access. Non-admin
  // portal users can manage everyone else but can neither promote a user to
  // admin/leadership nor modify someone who already holds it.
  if (!callerIsAdmin && (willBePortalAdmin || wasPortalAdmin)) {
    return NextResponse.json(
      { error: "Only admin/leadership can grant or change admin/leadership access" },
      { status: 403 },
    );
  }

  if (wasPortalAdmin && !willBePortalAdmin) {
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
        { error: "Cannot remove access from the last admin or leadership user" },
        { status: 400 },
      );
    }
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
  const auth = await requirePortalCaller(req, isAdminOrLeadership);
  if (auth instanceof NextResponse) return auth;

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
