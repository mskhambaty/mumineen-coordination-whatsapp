import { NextRequest, NextResponse } from "next/server";

import { requireAdminKey } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const departmentId = req.nextUrl.searchParams.get("department_id");

  let userIds: string[] | null = null;
  if (departmentId && departmentId !== "all") {
    const { data: memberships, error: membershipError } = await supabase
      .from("department_members")
      .select("user_id")
      .eq("department_id", departmentId)
      .eq("is_active", true);

    if (membershipError) {
      return NextResponse.json({ error: membershipError.message }, { status: 500 });
    }

    userIds = (memberships ?? []).map((membership) => membership.user_id as string);
    if (userIds.length === 0) {
      return NextResponse.json([]);
    }
  }

  let query = supabase
    .from("whatsapp_users")
    .select("id, display_name, phone_e164, email, role, global_role, status")
    .order("display_name");

  if (userIds) {
    query = query.in("id", userIds);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { display_name, phone_e164, email, global_role } = body;

  if (!display_name || !phone_e164) {
    return NextResponse.json({ error: "display_name and phone_e164 are required" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("whatsapp_users")
    .insert({
      display_name,
      phone_e164,
      email: email || null,
      global_role: global_role || "member",
      role: "committee",
      status: "active",
      transcript_aliases: [display_name],
    })
    .select("id, display_name, phone_e164, email, role, global_role, status")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
